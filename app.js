'use strict';
const $ = id => document.getElementById(id);
const canvas = $('stage'), g = canvas.getContext('2d');
const INK='#34372e', COLORS=['#ed956d','#b1b9e8','#e8be58','#8ebcb0','#c994ad'];
const state={buffer:null,analysis:null,context:null,master:null,source:null,playing:false,position:0,anchor:0,start:0,duration:30,loop:true,recording:false,recorder:null,chunks:[],loadToken:0,downloadUrl:null,busy:false};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const time=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;
const status=(s,error=false)=>{$('status').textContent=s;$('status').classList.toggle('error',error);};
function context(){if(!state.context){state.context=new AudioContext();state.master=state.context.createGain();state.master.connect(state.context.destination);}return state.context;}
function position(){return state.playing?clamp(state.context.currentTime-state.anchor,0,state.duration):state.position;}
function stopSource(){if(state.source){state.source.onended=null;try{state.source.stop();}catch{}state.source.disconnect();state.source=null;}}
function clearDownload(){if(state.downloadUrl)URL.revokeObjectURL(state.downloadUrl);state.downloadUrl=null;$('download').hidden=true;}
function setControls(){const blocked=state.busy||state.recording;for(const id of ['analyzeMusic','noteGate','danceMode','file','demo','replace','start','duration','seek','play','export','sensitivity','offset','gentle','loop'])$(id).disabled=blocked||(id==='export'&&!Score.ready())||(!state.buffer&&['analyzeMusic','start','duration','seek','play','export'].includes(id));document.querySelectorAll('.score-track input,.score-track button,#midiDownload,#jsonDownload').forEach(el=>el.disabled=blocked||!Score.bundle);}
function pause(){state.position=position();state.playing=false;document.querySelector('.stage-wrap').classList.remove('is-playing');stopSource();$('play').textContent='▶';$('play').setAttribute('aria-label','播放');$('stageState').textContent=state.buffer?'暂停 · 乐队待命':'乐队已就位';}
async function play(from=state.position){Score.stopSolo();const ac=context();await ac.resume();stopSource();if(from>=state.duration-.01)from=0;state.position=from;state.anchor=ac.currentTime+.06-from;state.source=ac.createBufferSource();state.source.buffer=state.buffer;state.source.connect(state.master);state.source.start(ac.currentTime+.06,state.start+from,state.duration-from);state.playing=true;document.querySelector('.stage-wrap').classList.add('is-playing');$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','暂停');$('stageState').textContent=state.recording?'正在录制演出':'正在演出 · 喵！';}
function changeRange(){if(!state.buffer)return;pause();let start=Number($('start').value),duration=Number($('duration').value);if(!Number.isFinite(start))start=0;if(!Number.isFinite(duration))duration=30;state.start=clamp(start,0,Math.max(0,state.buffer.duration-5));state.duration=clamp(duration,5,Math.min(300,state.buffer.duration-state.start));$('start').value=state.start.toFixed(1);$('duration').value=state.duration.toFixed(1);$('start').max=Math.max(0,state.buffer.duration-5);$('duration').max=Math.min(300,state.buffer.duration-state.start);$('durationLabel').textContent=`${state.duration.toFixed(1)} 秒`;$('totalTime').textContent=time(state.duration);$('seek').max=state.duration;state.position=0;clearDownload();Score.rangeChanged();setControls();$('rangeHint').textContent=`原曲 ${time(state.buffer.duration)} · 结束于 ${time(state.start+state.duration)}`;}
async function analyze(buffer,token){
  const channel=buffer.getChannelData(0);let energy=0;for(let i=0;i<channel.length;i+=16)energy+=channel[i]*channel[i];
  return {bpm:null,silent:Math.sqrt(energy/Math.ceil(channel.length/16))<.0002};
}
async function loadAudio(file){
  if(state.recording)return;
  const name=file.name||'音乐';if(!/\.(mp3|wav)$/i.test(name)){status('请选择 MP3 或 WAV 音频文件。',true);return;}
  if(file.size>50*1024*1024){status('文件超过 50 MB，请选取较小的 MP3/WAV。',true);return;}
  pause();const token=++state.loadToken;state.busy=true;setControls();status('正在载入音乐…');
  try{const buffer=await context().decodeAudioData(await file.arrayBuffer());await acceptBuffer(buffer,name,token);}
  catch(e){status(`音乐载入失败：${e.message||'音频损坏或无法解码，请尝试其他 MP3/WAV。'}`,true);}
  finally{if(token===state.loadToken){state.busy=false;setControls();$('file').value='';}}
}
async function acceptBuffer(buffer,name,token){
  if(buffer.duration<5)throw new Error('音乐至少需要 5 秒。');if(buffer.duration>600)throw new Error('Demo 支持最长 10 分钟的音乐。');
  const analysis=await analyze(buffer,token);if(token!==state.loadToken)return;
  Score.clear();state.buffer=buffer;state.analysis=analysis;state.start=0;state.duration=Math.min(30,buffer.duration);state.position=0;
  $('start').value=0;$('duration').value=state.duration;changeRange();$('fileName').textContent=name;$('fileMeta').textContent=`${time(buffer.duration)} · ${analysis.silent?'静音音频':`待提取独立声部`}`;$('fileInfo').hidden=false;$('dropzone').hidden=true;$('fileBadge').textContent='准备好啦';$('stageState').textContent='可预览 · 五猫就位';status(analysis.silent?'这段音乐接近静音，小猫会安静待命。':'音乐已载入。先点击“分离乐器并提取乐谱”，猫咪会按各自声部演奏。');
}
async function loadDemo(){
  if(state.recording)return;pause();state.busy=true;setControls();const token=++state.loadToken;status('正在准备猫猫原创 Demo…');
  try{
    const ac=context(),sr=22050,buf=ac.createBuffer(1,sr*36,sr),out=buf.getChannelData(0),beat=.5;
    const tracks=['drums','bass','guitar','piano','vocals'].map((id,i)=>({id,label:['鼓','贝斯','吉他','键盘','主唱'][i],notes:[],enabled:true}));
    tracks[4].phrases=[];
    const note=(track,start,length,pitch,velocity)=>tracks[track].notes.push({start,end:start+length,pitch,velocity});
    const add=(at,len,fn,volume)=>{const begin=Math.floor(at*sr),n=Math.floor(len*sr);for(let i=0;i<n&&begin+i<out.length;i++)out[begin+i]+=fn(i/sr,i/n)*volume;};
    let seed=512;const noise=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2147483648-1;};
    const bass=[130.81,130.81,164.81,146.83,110,110,146.83,196];const melody=[523.25,659.25,783.99,659.25,587.33,523.25,440,392];
    for(let n=0;n<72;n++){
      const at=n*beat;
      // 0–4 秒与 12–16 秒故意没有鼓：用于检查鼓手不会跟随其他声部乱动。
      if(at>=4&&!(at>=12&&at<16)){
        add(at,.32,(t)=>Math.sin(2*Math.PI*(42*t+6*(1-Math.exp(-35*t))))*Math.exp(-14*t),.36);note(0,at,.12,36,.85);
        if(n%2){add(at,.15,t=>noise()*Math.exp(-30*t),.14);note(0,at,.11,38,.68);}
        for(let h=0;h<2;h++){add(at+h*.25,.06,t=>noise()*Math.exp(-65*t),.045);note(0,at+h*.25,.075,42,.4);}
      }
      const f=bass[Math.floor(n/4)%8];add(at,.38,(t)=>Math.sin(2*Math.PI*f*t)*Math.exp(-9*t),.15);note(1,at,.38,Math.round(69+12*Math.log2(f/440)),.65);
      if(n%2===0||n>32){const m=melody[(n+Math.floor(n/16))%8];add(at+.125,.28,(t,u)=>Math.sin(2*Math.PI*m*t)*Math.sin(Math.PI*u)*Math.exp(-5*t),.1);note(3,at+.125,.28,Math.round(69+12*Math.log2(m/440)),.7);}
      if(at>=8){const f=melody[Math.floor(n/2)%8]/2;add(at,.3,(t,u)=>(Math.sin(2*Math.PI*f*t)+.25*Math.sin(2*Math.PI*f*2*t))*Math.exp(-12*t),.06);note(2,at,.3,Math.round(69+12*Math.log2(f/440)),.6);}
    }
    for(let i=0;i<out.length;i++)out[i]=Math.tanh(out[i])*Math.min(1,i/sr*3,(out.length-i)/sr*3);
    await acceptBuffer(buf,'猫猫排练曲 · Meow on the Beat',token);
    tracks.forEach(track=>track.notes.sort((a,b)=>a.start-b.start));
    Score.setDemo({version:2,source:'原创分轨 Demo · 内置准确乐谱',duration:36,tracks});
    status('纯器乐 Demo：主唱保持待命；前 4 秒和 12–16 秒没有鼓。上传有人声的歌曲并转谱，主唱才会开口。');
  }catch(e){status(e.message,true);}finally{state.busy=false;setControls();}
}
function round(x,y,w,h,r=10,fill,stroke=INK,width=3){g.beginPath();g.roundRect(x,y,w,h,r);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}}
function ellipse(x,y,rx,ry,fill,stroke=INK,width=3){g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}}
function line(points,color=INK,width=3){g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.strokeStyle=color;g.lineWidth=width;g.lineCap='round';g.lineJoin='round';g.stroke();}
function text(s,x,y,size=16,color=INK,align='center',font='Trebuchet MS'){g.fillStyle=color;g.font=`bold ${size}px "${font}","Microsoft YaHei",sans-serif`;g.textAlign=align;g.fillText(s,x,y);}
function draw(t){Score.draw(t);}
function tick(){const p=position();if(state.playing&&p>=state.duration-.005){if(state.recording)finishExport();else if(state.loop){pause();state.position=0;play(0).catch(e=>status(e.message,true));}else{pause();state.position=state.duration;$('stageState').textContent='演出结束 · 再来一遍？';}}const current=position();$('currentTime').textContent=time(current);$('seek').value=current;if(state.recording){$('recordProgress').value=current/state.duration;$('exportLabel').textContent=`正在录制 ${Math.round(current/state.duration*100)}%`;}
  draw(current);requestAnimationFrame(tick);
}
let recordingDest=null,cancelled=false;
async function exportVideo(){
  if(!state.buffer||state.recording||!Score.ready())return;
  if(location.protocol==='file:'){status('照片素材视频导出需要本地工作台。请运行“启动猫咪乐队.cmd”，访问 http://127.0.0.1:8766。',true);return;}
  if(!window.MediaRecorder||!canvas.captureStream){status('当前浏览器不支持视频导出，请用桌面 Chrome 或 Edge。',true);return;}
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime){status('浏览器不支持 WebM 录制，请用桌面 Chrome/Edge。',true);return;}
  pause();clearDownload();state.position=0;draw(0);const ac=context();await ac.resume();cancelled=false;state.chunks=[];
  let stream;
  try{recordingDest=ac.createMediaStreamDestination();state.master.connect(recordingDest);stream=canvas.captureStream(30);recordingDest.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000,audioBitsPerSecond:192000});state.recorder=recorder;
    recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data);};
    recorder.onerror=()=>{cancelled=true;status('录制遇到错误，请重试。',true);finishExport();};
    recorder.onstop=()=>{
      stream.getTracks().forEach(track=>track.stop());if(recordingDest){state.master.disconnect(recordingDest);recordingDest=null;}
      const blob=new Blob(state.chunks,{type:mime});state.chunks=[];state.recorder=null;
      if(!cancelled&&blob.size){state.downloadUrl=URL.createObjectURL(blob);const link=$('download');link.href=state.downloadUrl;link.download=`喵拍-猫咪乐队-${Date.now()}.webm`;link.textContent=`↓ 下载演出视频 · ${(blob.size/1024/1024).toFixed(1)} MB`;link.hidden=false;status('演出录好啦！点击下载保存到电脑。');$('stageState').textContent='演出已完成';}
      state.recording=false;document.body.classList.remove('recording');$('exportProgress').hidden=true;setControls();
    };
    state.recording=true;document.body.classList.add('recording');setControls();$('exportProgress').hidden=false;status('正在按真实时长录制，请保持页面在前台。');recorder.start(250);await play(0);
  }catch(e){cancelled=true;if(state.recorder&&state.recorder.state!=='inactive')finishExport();else{stream?.getTracks().forEach(t=>t.stop());if(recordingDest){state.master.disconnect(recordingDest);recordingDest=null;}state.recording=false;setControls();}status(`导出失败：${e.message}`,true);}
}
function finishExport(){pause();if(state.recorder&&state.recorder.state!=='inactive')state.recorder.stop();}
$('file').addEventListener('change',e=>{if(e.target.files[0])loadAudio(e.target.files[0]);});
$('replace').onclick=()=>$('file').click();$('demo').onclick=loadDemo;
for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('dragover');if(type==='drop'&&!state.busy&&e.dataTransfer.files[0])loadAudio(e.dataTransfer.files[0]);});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
for(const id of ['start','duration'])$(id).onchange=changeRange;
$('play').onclick=()=>{if(state.playing)pause();else play().catch(e=>status(`无法播放：${e.message}`,true));};
$('seek').oninput=()=>{const wasPlaying=state.playing;pause();state.position=Number($('seek').value);if(wasPlaying)play(state.position).catch(e=>status(e.message,true));};
$('loop').onclick=()=>{state.loop=!state.loop;$('loop').classList.toggle('active',state.loop);$('loop').setAttribute('aria-pressed',String(state.loop));};
$('sensitivity').oninput=()=>{$('sensitivityValue').textContent=Number($('sensitivity').value).toFixed(1)+'×';clearDownload();};
$('offset').oninput=()=>{$('offsetValue').textContent=`${Number($('offset').value)>0?'+':''}${$('offset').value} ms`;clearDownload();};
$('gentle').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;$('gentle').onchange=clearDownload;
$('export').onclick=exportVideo;$('cancelExport').onclick=()=>{cancelled=true;finishExport();status('已取消录制，仍可继续调整和预览。');};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.recording){cancelled=true;finishExport();status('页面进入后台，录制已取消。请保持页面在前台后重新导出。',true);}});
$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
Score.setup();setControls();tick();
