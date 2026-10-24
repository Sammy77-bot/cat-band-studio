"""Local-only six-stem separation + per-instrument note transcription service."""
from __future__ import annotations
import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import threading
import time
import traceback
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
JOBS_DIR = RUNTIME / 'jobs'
JOBS_DIR.mkdir(parents=True, exist_ok=True)
os.environ['TORCH_HOME'] = str(RUNTIME / 'models')
# Only the configured official Meta checkpoint is loaded; it contains model class metadata.
os.environ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD'] = '1'
JOBS = {}
POOL = concurrent.futures.ThreadPoolExecutor(max_workers=1)
LOCK = threading.Lock()
MODEL = None
PITCH = None
TRACKS = [('drums', '鼓'), ('bass', '贝斯'), ('guitar', '吉他'), ('piano', '键盘'), ('vocals', '主唱')]


def update(job, progress, message):
    job.update(progress=progress, message=message)
    if job.get('cancelled'):
        raise RuntimeError('用户取消了分析')


def load_models(job):
    global MODEL, PITCH
    import torch
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    if MODEL is None:
        update(job, .04, '载入六声部分离模型（首次使用需下载权重）…')
        from demucs.pretrained import get_model
        MODEL = get_model('htdemucs_6s')
        MODEL.eval()
    if PITCH is None:
        update(job, .12, '载入 Basic Pitch 音符转录模型…')
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        from basic_pitch.inference import Model
        PITCH = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))


def analyze_job(job_id, raw):
    job = JOBS[job_id]
    try:
        import numpy as np
        import soundfile as sf
        import librosa
        import torch
        import pretty_midi
        from scipy.signal import resample_poly
        from math import gcd
        from demucs.apply import apply_model
        from basic_pitch.inference import predict
        job['state'] = 'running'
        audio, sr = sf.read(io.BytesIO(raw), always_2d=True, dtype='float32')
        if not 4.9 <= len(audio)/sr <= 300.1 or audio.shape[1] > 2:
            raise ValueError('请选择 5–300 秒的单/双声道片段')
        if not np.isfinite(audio).all():
            raise ValueError('音频包含无效采样')
        duration = len(audio)/sr
        folder = JOBS_DIR / job_id
        folder.mkdir(exist_ok=True)
        load_models(job)
        update(job, .18, '正在分离鼓、贝斯、吉他、钢琴、人声和其他声部…')
        target_sr = MODEL.samplerate
        if sr != target_sr:
            divisor = gcd(sr, target_sr)
            audio = resample_poly(audio, target_sr//divisor, sr//divisor, axis=0).astype('float32')
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        mix = torch.from_numpy(audio.T.copy())
        ref = mix.mean(0)
        mean, std = ref.mean(), ref.std().clamp(min=1e-6)
        # No random shifts: rerunning a clip should produce reproducible note timings.
        with torch.no_grad():
            sources = apply_model(MODEL, ((mix-mean)/std)[None], device='cpu', shifts=0,
                                  split=True, overlap=.25, progress=False)[0] * std
        update(job, .57, '声部分离完成，正在提取各乐器的音符与敲击…')
        mixture = np.mean(audio, axis=1)
        mixed_rms = float(np.sqrt(np.mean(mixture**2)))
        midi = pretty_midi.PrettyMIDI(initial_tempo=120)
        results = []
        for idx, (key, name) in enumerate(TRACKS):
            update(job, .58 + idx*.36/len(TRACKS), f'正在转录{name}声部…')
            signal = sources[MODEL.sources.index(key)].cpu().numpy().mean(axis=0)
            sf.write(folder/f'{key}.wav', signal, target_sr, subtype='PCM_16')
            mono = librosa.resample(signal, orig_sr=target_sr, target_sr=22050)
            rms = float(np.sqrt(np.mean(mono**2)))
            ratio = rms/max(mixed_rms, 1e-7)
            envelope = librosa.feature.rms(y=mono, frame_length=1024, hop_length=220)[0]
            local_mix = librosa.feature.rms(y=librosa.resample(mixture, orig_sr=target_sr, target_sr=22050), frame_length=1024, hop_length=220)[0]
            # Gate leakage against the ORIGINAL mix, never normalize each quiet stem to full scale.
            def audible(start, end):
                begin, finish = max(0,int(start*100)), max(1,int(end*100)+1)
                e = envelope[begin:finish]
                m = local_mix[begin:finish]
                return bool(len(e) and float(np.max(e)) > .0025 and
                            float(np.mean(e)) > max(.001, float(np.mean(m))*.07))
            notes = []
            phrases = []
            voice_envelope = None
            if key == 'vocals':
                # Singing motion uses only the separated vocal envelope; even unpitched
                # syllables may open the mouth, while instrumental sections must not.
                smooth = np.convolve(envelope, np.ones(3)/3, mode='same')
                strength = np.zeros(len(smooth))
                if rms > .001 and ratio > .035:
                    gate = (smooth > .003) & (smooth > np.maximum(.001, local_mix[:len(smooth)]*.10))
                    peak = max(float(np.quantile(smooth, .95)), .004)
                    padded = np.r_[False, gate, False].astype(int)
                    beginnings = np.flatnonzero(np.diff(padded)==1)
                    endings = np.flatnonzero(np.diff(padded)==-1)
                    for first, last in zip(beginnings, endings):
                        if last-first < 5:
                            continue
                        strength[first:last] = np.clip(smooth[first:last]/peak, 0, 1)
                        phrases.append(dict(start=round(first*220/22050,4),
                            end=round(min(duration,last*220/22050),4),pitch=60,
                            velocity=round(float(np.max(strength[first:last])),3)))
                voice_envelope = dict(step=220/22050,values=np.round(strength,3).tolist())
            if rms > .001 and ratio > .035:
                if key == 'drums':
                    onset = librosa.onset.onset_strength(y=mono, sr=22050, hop_length=220)
                    peaks = librosa.onset.onset_detect(onset_envelope=onset, sr=22050,
                        hop_length=220, backtrack=False, units='time', wait=5, delta=.12)
                    for stamp in peaks:
                        start = max(0, float(stamp)-.025)
                        end = min(duration,start+.11)
                        if not audible(start,end):
                            continue
                        chunk=mono[int(start*22050):int(end*22050)]
                        spectrum=np.abs(np.fft.rfft(chunk))
                        freqs=np.fft.rfftfreq(len(chunk),1/22050)
                        low=float(spectrum[freqs<180].sum())
                        high=float(spectrum[freqs>3500].sum())
                        pitch=36 if low>high*1.6 else 42 if high>low*2 else 38
                        velocity=min(1.,max(.12,float(np.max(np.abs(chunk)))*2.5))
                        notes.append(dict(start=round(start,4),end=round(end,4),pitch=pitch,velocity=round(velocity,3)))
                else:
                    low, high = {'bass':(32,400),'guitar':(70,1500),'piano':(32,2100),'vocals':(65,1600)}[key]
                    _, _, events = predict(folder/f'{key}.wav', PITCH, onset_threshold=.55,
                        frame_threshold=.35, minimum_note_length=90, minimum_frequency=low,
                        maximum_frequency=high, melodia_trick=False)
                    for start,end,pitch,velocity,_ in events:
                        start,end=max(0,float(start)),min(duration,float(end))
                        if end-start < .07 or not audible(start,end):
                            continue
                        notes.append(dict(start=round(start,4),end=round(end,4),pitch=int(pitch),velocity=round(float(velocity),3)))
            notes.sort(key=lambda n:n['start'])
            instrument=pretty_midi.Instrument(program={'drums':0,'bass':33,'guitar':27,'piano':0,'vocals':53}[key],is_drum=key=='drums',name=key)
            for note in notes:
                instrument.notes.append(pretty_midi.Note(velocity=max(1,min(127,round(note['velocity']*127))),pitch=note['pitch'],start=note['start'],end=note['end']))
            midi.instruments.append(instrument)
            track=dict(id=key,label=name,notes=notes,rms=round(rms,6),ratio=round(ratio,4),audio=f'/jobs/{job_id}/{key}.wav',enabled=True)
            if key == 'vocals':
                track.update(phrases=phrases,envelope=voice_envelope)
            results.append(track)
        midi.write(str(folder/'score.mid'))
        result=dict(version=3,source='Demucs htdemucs_6s + Spotify Basic Pitch (ONNX)',
                    duration=duration,tracks=results,midi=f'/jobs/{job_id}/score.mid',
                    note='模型估计的 MIDI 事件；鼓音色分类和吉他/钢琴声部分离可能有误差，请试听分轨并检查事件。')
        (folder/'score.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
        update(job, 1, '分离与转谱完成')
        job.update(state='done',result=result)
    except Exception as exc:
        traceback.print_exc()
        job.update(state='error',message=str(exc),progress=0)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def end_headers(self):
        origin=self.headers.get('Origin','')
        if origin=='null' or re.fullmatch(r'http://(127\.0\.0\.1|localhost):8766',origin):
            self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Cache-Control','no-store')
        super().end_headers()

    def json_response(self,data,code=200):
        raw=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204);self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type');self.end_headers()

    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/api/health':
            return self.json_response(dict(version=3,ready=all(importlib.util.find_spec(x) is not None for x in ['torch','demucs','basic_pitch','onnxruntime']),modelLoaded=MODEL is not None))
        match=re.fullmatch(r'/api/jobs/([a-f0-9]{32})',path)
        if match:
            return self.json_response(JOBS.get(match[1],dict(state='error',message='任务不存在')))
        match=re.fullmatch(r'/jobs/([a-f0-9]{32})/(drums\.wav|bass\.wav|guitar\.wav|piano\.wav|vocals\.wav|score\.mid|score\.json)',path)
        if match:
            self.path='/.runtime'+path
            return super().do_GET()
        if path in ['/','/index.html','/app.js','/score.js','/style.css','/favicon.ico'] or re.fullmatch(r'/assets/[a-z-]+\.png',path):
            return super().do_GET()
        self.send_error(404)

    def do_POST(self):
        origin=self.headers.get('Origin','')
        if origin and origin!='null' and not re.fullmatch(r'http://(127\.0\.0\.1|localhost):8766',origin):
            return self.json_response(dict(error='仅允许本机页面访问'),403)
        if self.path!='/api/analyze':
            return self.json_response(dict(error='接口不存在'),404)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 44 <= length <= 52*1024*1024:
                raise ValueError('片段大小不合法')
            with LOCK:
                if any(j['state'] in ['queued','running'] for j in JOBS.values()):
                    return self.json_response(dict(error='已有音乐正在分析，请等待完成'),409)
                raw=self.rfile.read(length)
                if len(raw)!=length or raw[:4]!=b'RIFF' or raw[8:12]!=b'WAVE':
                    raise ValueError('需要 PCM WAV 片段')
                job_id=uuid.uuid4().hex
                JOBS[job_id]=dict(state='queued',progress=0,message='排队准备分析…')
                POOL.submit(analyze_job,job_id,raw)
            self.json_response(dict(id=job_id),202)
        except Exception as exc:
            self.json_response(dict(error=str(exc)),400)


if __name__=='__main__':
    print('CatBand local studio: http://127.0.0.1:8766',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8766),Handler).serve_forever()
