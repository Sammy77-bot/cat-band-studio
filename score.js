'use strict';
// Only note events from isolated stems (or the demo's known score) drive the cats.
const Score = (()=>{
  const ids=['drums','bass','guitar','piano','vocals'],labels=['鼓','贝斯','吉他','键盘','主唱'];
  const sprites={};let bundle=null,origin=0,demo=null,solo=null,scoreUrl=null,midiUrl=null;
  const poseLayers={};
  const MOTION={attack:.065,release:.24,springWindow:.64,damping:8.5,frequency:20,bounce:13,squash:.055,tilt:.022};
  const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
  const api=location.protocol==='file:'?'http://127.0.0.1:8766':'';
  const empty=()=>({level:0,hit:false,pitch:0,start:-99});
  function assetsReady(){return ids.every(id=>sprites[id]?.complete&&sprites[id]?.naturalWidth>0);}
  function ready(){return !!bundle&&(!state.busy)&&assetsReady();}
  function clear(){bundle=null;demo=null;if(solo){solo.pause();solo=null;}if(scoreUrl)URL.revokeObjectURL(scoreUrl);if(midiUrl)URL.revokeObjectURL(midiUrl);scoreUrl=midiUrl=null;renderPanel();}
  function rangeChanged(){if(demo){bundle=demo;origin=0;}else{bundle=null;}$('analyzeMusic').disabled=!state.buffer||state.busy;renderPanel();}
  function assign(data,start=0){bundle=data;origin=start;$('fileMeta').textContent=`${time(state.buffer.duration)} · 独立声部乐谱已就绪`;$('fileBadge').textContent='乐谱就绪';$('stageState').textContent='乐谱已就绪 · 可预览';renderPanel();setControls();}
  function setDemo(data){demo=data;assign(data,0);}
  function levels(absolute){
    if(!bundle)return ids.map(empty);
    const t=absolute-origin-Number($('offset').value)/1000;
    const filter=Number($('noteGate').value),scale=Number($('sensitivity').value);
    return ids.map(id=>{const track=bundle.tracks.find(t=>t.id===id);if(!track||track.enabled===false)return empty();
      if(id==='vocals'&&track.envelope){const env=track.envelope;const index=Math.floor(t/env.step);const value=index>=0&&index<env.values.length?env.values[index]:0;if(value<filter||value<=0)return empty();const phrase=(track.phrases||[]).find(p=>p.start<=t&&p.end>=t);return {level:Math.min(1,value*scale),hit:true,pitch:60,start:phrase?.start??t};}
      let best=empty();for(const note of track.notes){if(note.start>t)break;if(note.velocity<filter||t<note.start||t>note.end)continue;const age=t-note.start;
        const level=note.velocity*scale*(id==='drums'?Math.max(0,1-age/.14):1);
        if(level>best.level)best={level:Math.min(1,level),hit:age<.12,pitch:note.pitch,start:note.start};}
      return best;
    });
  }
  function motionAt(id,absolute){
    const rest={pose:0,bounce:0,sx:1,sy:1,rotation:0,energy:0};
    const track=bundle?.tracks.find(track=>track.id===id);if(!track||track.enabled===false)return rest;
    const t=absolute-origin-Number($('offset').value)/1000,gate=Number($('noteGate').value),gain=Number($('sensitivity').value);
    const mode=$('danceMode')?.value||'elastic',amount=$('gentle').checked?.15:1;
    let energy=0,pulse=0;const impulses=new Map();
    // 动画直接由音频时间计算，不积累屏幕帧差；拖动、暂停和导出会得到同一姿态。
    for(const note of (id==='vocals'?track.phrases||track.notes:track.notes)){
      if(note.start>t)break;if(note.velocity<gate)continue;const age=t-note.start;
      if(t<=note.end+MOTION.release){const attack=smooth(age/MOTION.attack),release=1-smooth((t-note.end)/MOTION.release);energy=Math.max(energy,attack*release*note.velocity*gain);}
      if(age<MOTION.springWindow){const key=Math.round(note.start/.025);const old=impulses.get(key);if(!old||note.velocity>old.velocity)impulses.set(key,{age,velocity:note.velocity});}
    }
    for(const hit of impulses.values())pulse+=Math.sin(hit.age*MOTION.frequency)*Math.exp(-hit.age*MOTION.damping)*hit.velocity*gain*(1-smooth((hit.age-.4)/.24));
    if(id==='vocals'&&track.envelope){
      const env=track.envelope,index=Math.floor(t/env.step);let sum=0,weights=0;
      // 只平滑过去的人声，不提前张嘴；约 150 ms 的释放让停口自然收住。
      for(let j=0;j<=Math.ceil(.16/env.step);j++){const weight=Math.exp(-j*env.step/.042),value=env.values[index-j]||0;sum+=(value>=gate?value:0)*weight;weights+=weight;}
      energy=sum/weights*gain;pulse+=Math.sin(t*13)*energy*.22;
    }
    energy=Math.min(1,energy);pulse=Math.max(-.65,Math.min(1,pulse));
    if(energy<.0001&&Math.abs(pulse)<.0001)return rest;
    // QQ/摇摆使用稳定单图，避免不同脸型叠化成双眼重影；主唱保留口型过渡。
    const pose=id==='vocals'||mode==='performance'?smooth(energy/.6):0;
    if(mode==='performance')return {...rest,pose,energy};
    if(mode==='sway')return {...rest,pose,energy,bounce:-energy*3*(1-Math.cos(t*5))*amount,rotation:Math.sin(t*5)*energy*.018*amount};
    // 以脚底为支点的阻尼回弹：先拉伸离地，再压扁落地，振幅很快衰减。
    return {pose,energy,bounce:-pulse*MOTION.bounce*amount,sx:1-pulse*MOTION.squash*.7*amount,sy:1+pulse*MOTION.squash*amount,rotation:(pulse*MOTION.tilt+Math.sin(t*5)*energy*.006)*amount};
  }
  function blendedPose(id,img,weight){
    const half=img.naturalWidth/2;
    if(weight<=.001)return {image:img,x:0,w:half,h:img.naturalHeight};
    if(weight>=.999)return {image:img,x:half,w:half,h:img.naturalHeight};
    let layer=poseLayers[id];if(!layer){const c=document.createElement('canvas');c.width=512;c.height=512;layer=poseLayers[id]={canvas:c,ctx:c.getContext('2d')};}
    const p=layer.ctx;p.clearRect(0,0,512,512);p.globalCompositeOperation='source-over';p.globalAlpha=1-weight;p.drawImage(img,0,0,half,img.naturalHeight,0,0,512,512);
    // 相加合成两张预乘透明图，避免普通叠加在半程把猫变得半透明。
    p.globalCompositeOperation='lighter';p.globalAlpha=weight;p.drawImage(img,half,0,half,img.naturalHeight,0,0,512,512);p.globalAlpha=1;p.globalCompositeOperation='source-over';
    return {image:layer.canvas,x:0,w:512,h:512};
  }
  function drawSprite(id,x,bottom,size,event,t,gentle){const img=sprites[id];if(!img?.complete||!img.naturalWidth)return;
    const motion=motionAt(id,state.start+t),pose=blendedPose(id,img,motion.pose);
    g.save();g.translate(x,bottom+motion.bounce);g.rotate(motion.rotation);g.scale(motion.sx,motion.sy);
    g.drawImage(pose.image,pose.x,0,pose.w,pose.h,-size/2,-size,size,size);g.restore();
  }
  function draw(t){
    const a=levels(state.start+t),gentle=$('gentle').checked;
    g.clearRect(0,0,1280,720);g.fillStyle='#fffefa';g.fillRect(0,0,1280,720);
    const bg=g.createLinearGradient(0,520,0,720);bg.addColorStop(0,'#fffefa');bg.addColorStop(1,'#e4dfd4');g.fillStyle=bg;g.fillRect(0,520,1280,200);
    // Rear drummer, three photo-cutout musicians in front: match the user's collage reference.
    drawSprite('drums',655,475,395,a[0],t,gentle);
    drawSprite('piano',366,552,385,a[3],t,gentle);
    drawSprite('bass',200,679,398,a[1],t,gentle);
    drawSprite('guitar',1060,684,437,a[2],t,gentle);
    drawSprite('vocals',662,713,370,a[4],t,gentle);
    a.forEach((e,i)=>{$('meter'+i).style.width=`${e.level*100}%`;});
    drawRoll(t);
  }
  function drawRoll(t){const c=$('scoreRoll');if(!c)return;const p=c.getContext('2d');p.clearRect(0,0,c.width,c.height);p.fillStyle='#fcfaf3';p.fillRect(0,0,c.width,c.height);
    for(let i=0;i<ids.length;i++){p.fillStyle='#8b8678';p.font='15px "Microsoft YaHei"';p.fillText(labels[i],12,32+i*45);p.strokeStyle='#e3ded2';p.beginPath();p.moveTo(76,i*45+49);p.lineTo(1200,i*45+49);p.stroke();}
    if(bundle)bundle.tracks.forEach((track,i)=>{p.fillStyle=COLORS[i];p.globalAlpha=track.enabled===false?.2:1;for(const n of (track.id==='vocals'?track.phrases||track.notes:track.notes)){const st=n.start+origin-state.start,en=n.end+origin-state.start;if(en<0||st>state.duration)continue;const x=82+Math.max(0,st)/state.duration*1100,w=Math.max(3,(Math.min(state.duration,en)-Math.max(0,st))/state.duration*1100);p.fillRect(x,12+i*45+(84-n.pitch)/8,w,9);}});p.globalAlpha=1;
    p.fillStyle='#ed713f';p.fillRect(82+t/state.duration*1100,4,2,c.height-10);
  }
  function renderPanel(){if(!$('scoreTracks'))return;$('scoreTracks').replaceChildren();$('scoreSource').textContent=bundle?bundle.source:'上传后先分离声部，再提取音符';$('analyzeMusic').textContent=bundle?'重新分离与转谱':'分离乐器并提取乐谱';
    ids.forEach((id,i)=>{const track=bundle?.tracks.find(t=>t.id===id);const row=document.createElement('div');row.className='score-track';const check=document.createElement('input');check.type='checkbox';check.checked=track?.enabled!==false;check.disabled=!track;check.setAttribute('aria-label',labels[i]+'参与演奏');check.onchange=()=>{if(track){track.enabled=check.checked;clearDownload();}};const label=document.createElement('b');label.textContent=labels[i];const count=document.createElement('span');count.textContent=track?(id==='vocals'?`${(track.phrases||track.notes).length} 段人声`:`${track.notes.length} ${i===0?'次敲击':'个音符'}`):'待转谱';row.append(check,label,count);
      if(track?.audio){const b=document.createElement('button');b.textContent='试听声部';b.className='text-button';b.onclick=async()=>{if(solo){solo.pause();solo=null;}pause();solo=new Audio(api+track.audio);try{await solo.play();status(`正在试听${labels[i]}分离声部，可随时播放原曲停止试听。`);}catch(e){status('声部试听失败：'+e.message,true);}};row.append(b);} $('scoreTracks').append(row);});
    $('scoreDownloads').hidden=!bundle;
  }
  function pcm(){const count=Math.floor(state.duration*44100),channels=2,ab=new ArrayBuffer(44+count*channels*2),v=new DataView(ab);const put=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));put(0,'RIFF');v.setUint32(4,ab.byteLength-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,44100,true);v.setUint32(28,44100*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,count*channels*2,true);
    const a=state.buffer;for(let i=0;i<count;i++){const idx=Math.min(a.length-1,Math.floor((state.start+i/44100)*a.sampleRate));for(let c=0;c<2;c++)v.setInt16(44+(i*2+c)*2,Math.round(Math.max(-1,Math.min(1,a.getChannelData(Math.min(c,a.numberOfChannels-1))[idx]))*32767),true);}return ab;}
  async function analyze(){
    if(state.busy||state.recording||!state.buffer)return;pause();if(solo)solo.pause();bundle=null;demo=null;clearDownload();renderPanel();state.busy=true;setControls();$('analysisProgress').hidden=false;const begin=state.start,token=state.loadToken;
    try{const health=await fetch(api+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json());if(!health.ready)throw Error('本地模型依赖未安装，请运行启动猫咪乐队.cmd。');
      const r=await fetch(api+'/api/analyze',{method:'POST',headers:{'Content-Type':'audio/wav'},body:pcm()});const body=await r.json();if(!r.ok)throw Error(body.error||'无法开始分析');
      while(true){const job=await fetch(api+`/api/jobs/${body.id}`).then(r=>r.json());if(token!==state.loadToken)return;$('analysisMeter').value=job.progress||0;$('analysisMessage').textContent=job.message;status(job.message);if(job.state==='error')throw Error(job.message);if(job.state==='done'){assign(job.result,begin);status('乐器声部与乐谱已提取。可试听各声部，勾选参演乐手；无音符时猫咪保持静止。');break;}await new Promise(r=>setTimeout(r,900));}
    }catch(e){status(`转谱未完成：${e.message}。请双击“启动猫咪乐队.cmd”，然后在本地网页重试。`,true);}finally{state.busy=false;$('analysisProgress').hidden=true;setControls();}
  }
  function currentScore(){const shift=events=>(events||[]).map(n=>({...n,start:Math.max(0,n.start+origin-state.start),end:Math.min(state.duration,n.end+origin-state.start)})).filter(n=>n.end>n.start&&n.start<state.duration);return {...bundle,duration:state.duration,start:state.start,tracks:bundle.tracks.map(track=>{const result={...track,notes:shift(track.notes)};if(track.phrases)result.phrases=shift(track.phrases);if(track.envelope){const e=track.envelope,first=Math.floor((state.start-origin)/e.step),count=Math.ceil(state.duration/e.step);result.envelope={step:e.step,values:Array.from({length:count},(_,i)=>e.values[first+i]||0)};}return result;})};}
  function downloadData(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function midi(){if(!bundle)return;const data=currentScore();const bytes=[],u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],vl=n=>{let out=[n&127];while(n>>=7)out.unshift((n&127)|128);return out;};bytes.push(...[77,84,104,100,0,0,0,6,0,1,0,4,1,224]);
    bytes[10]=(data.tracks.length>>>8)&255;bytes[11]=data.tracks.length&255;
    data.tracks.forEach((track,i)=>{let events=[];const ch=i===0?9:i;for(const n of track.notes){events.push([Math.round(n.start*960),1,[0x90|ch,n.pitch,Math.max(1,Math.min(127,Math.round(n.velocity*127)))]]);events.push([Math.round(n.end*960),0,[0x80|ch,n.pitch,0]]);}events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let prev=0,out=i===0?[0,255,81,3,7,161,32]:[];for(const [tick,,event]of events){out.push(...vl(tick-prev),...event);prev=tick;}out.push(0,255,47,0);bytes.push(77,84,114,107,...u32(out.length),...out);});downloadData(new Blob([new Uint8Array(bytes)],{type:'audio/midi'}),'猫乐队-乐谱.mid');}
  function setup(){
    const dance=document.createElement('label');dance.className='dance-choice';dance.htmlFor='danceMode';dance.innerHTML='<span>律动方式</span><select id="danceMode"><option value="elastic">QQ 弹弹</option><option value="sway">轻柔摇摆</option><option value="performance">只做演奏动作</option></select>';document.querySelector('.tuning .section-title').after(dance);
    $('danceMode').onchange=clearDownload;
    if(location.protocol==='file:'){const notice=document.createElement('div');notice.className='local-notice';notice.innerHTML='这是本地文件预览。分析与照片视频导出请运行“启动猫咪乐队.cmd”，然后 <a href="http://127.0.0.1:8766">打开完整工作台 ↗</a>';document.querySelector('main').prepend(notice);}
    const controls=document.querySelector('.controls');const section=document.createElement('section');section.className='panel analysis-panel';section.innerHTML='<div class="section-title"><span class="number">04</span><h2>先听清每个乐器</h2></div><p class="hint">本机分离独立声部 → 转成音符 / 敲击 → 驱动动作。没有事件，乐手就待命。</p><button id="analyzeMusic" class="primary">分离乐器并提取乐谱</button><p class="hint">上传音乐需要运行“启动猫咪乐队.cmd”。CPU 分析可能需数分钟，音乐不离开本机。</p><div id="analysisProgress" hidden><progress id="analysisMeter" max="1"></progress><p id="analysisMessage"></p></div>';controls.append(section);
    const panel=document.createElement('section');panel.className='score-panel';panel.innerHTML='<div class="band-title"><h2>声部乐谱 <span>NOTE EVENTS</span></h2><span id="scoreSource"></span></div><div id="scoreTracks"></div><canvas id="scoreRoll" width="1200" height="245" aria-label="四个乐器与主唱人声的时间轴"></canvas><div class="score-settings"><label for="noteGate">弱音过滤 <input id="noteGate" type="range" min="0" max="0.65" value="0.1" step="0.01"><output id="gateValue">0.10</output></label><span>可过滤分离残响；识别有误时可取消对应乐手。</span></div><div id="scoreDownloads" hidden><button id="midiDownload" class="text-button">↓ 下载 MIDI 乐谱</button><button id="jsonDownload" class="text-button">↓ 下载音符事件 JSON</button></div>';document.querySelector('.export-bar').before(panel);
    $('analyzeMusic').onclick=analyze;$('noteGate').oninput=()=>{$('gateValue').textContent=Number($('noteGate').value).toFixed(2);clearDownload();};$('midiDownload').onclick=midi;$('jsonDownload').onclick=()=>{if(bundle)downloadData(new Blob([JSON.stringify(currentScore(),null,2)],{type:'application/json'}),'猫乐队-音符.json');};
    ids.forEach((id,i)=>{const img=new Image();img.onload=()=>setControls();img.onerror=()=>status('猫咪素材载入失败，请刷新本地工作台。',true);sprites[id]=img;img.src=`assets/${id==='bass'?'bass-four-tuners':id==='piano'?'keys-tabby':id}.png`;});renderPanel();
  }
  return {setup,draw,levels,motionAt,clear,rangeChanged,setDemo,assign,ready,assetsReady,analyze,stopSolo:()=>{if(solo){solo.pause();solo=null;}},get bundle(){return bundle;}};
})();
