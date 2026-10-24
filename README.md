# 喵拍 · Cat Band Studio

一个纯本地运行的猫咪乐队音乐视频 Demo。上传 MP3/WAV，分离鼓、贝斯、吉他、键盘与人声，估计音符事件并驱动猫咪表演；可预览和导出带原曲音轨的 1280×720 WebM 视频。音乐及分轨都留在自己的电脑上。

## Windows 快速开始

需要 Windows 10/11、Python 3.13（安装时勾选 Add Python to PATH）和桌面 Chrome/Edge。首次安装需要网络连接和约 4 GB 可用空间。

1. 克隆或下载本仓库。
2. 双击 setup-windows.cmd，等待 CPU 版 PyTorch、音频分析依赖和 Basic Pitch ONNX 模型运行库安装完成。
3. 双击 启动猫咪乐队.cmd，浏览器会打开 http://127.0.0.1:8766。
4. 第一次点击“分离乐器并提取乐谱”时，Demucs 会从官方来源下载分轨模型权重到 .runtime/models/；需要网络连接，后续会复用本机缓存。

以后只需双击启动入口。安装和模型下载都只在首次进行。模型下载后可以断网使用。

## 手动配置

安装 Python 3.13 后，在仓库目录打开 PowerShell：

    py -3.13 -m venv .venv
    .venv\Scripts\python.exe -m pip install --upgrade pip
    .venv\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.9.1 torchaudio==2.9.1
    .venv\Scripts\python.exe -m pip install -r requirements-local.txt
    .venv\Scripts\python.exe -m pip install --no-deps basic-pitch==0.4.0
    .venv\Scripts\python.exe launch.py

Basic Pitch 使用 ONNX 后端，故以 --no-deps 安装以跳过其不需要的 TensorFlow 依赖。PyTorch 与 TorchAudio 需保持相同版本；以上命令配置 CPU 版本，无需 NVIDIA 显卡。也可以运行 python server.py 手动启动服务，再访问 http://127.0.0.1:8766。

macOS/Linux 可按相同版本在虚拟环境中安装 PyTorch 与 requirements-local.txt，再用 python -m pip install --no-deps basic-pitch==0.4.0；运行 python launch.py。自动配置脚本目前面向 Windows。

## 使用

1. 上传 MP3/WAV（5 秒至 10 分钟，最大 50 MB）。
2. 选择起点及 5–300 秒的转译片段，然后点“分离乐器并提取乐谱”。长片段会需要更多处理时间。
3. 转译完成后可试听每个声部、查看音符时间轴、调整弱音过滤和是否让对应乐手参演。
4. 播放预览，调整节拍偏移与动作灵敏度；点击“导出演出视频”保存 WebM。录制时请让页面保持前台。

## 乐队与乐谱

- 使用官方 Demucs htdemucs_6s 分离鼓、贝斯、吉他、钢琴、人声与其他声部。
- Spotify Basic Pitch ONNX 估计旋律声部的音符起止、音高和力度；鼓点通过分离鼓轨的起音检测，并以频谱启发式估计音色。
- 动作按各自分轨事件同步；没有识别到事件的乐手保持待命。估计结果可能漏音或串音，提供分轨试听、弱音过滤和参演开关。
- 原创器乐 Demo 内置准确乐谱，无需模型转译即可试听。鼓段空缺用于检查鼓手待命。
- 默认 QQ 弹弹律动；另有轻柔摇摆和只演奏模式。动作由音频时间计算，暂停、拖动和导出保持同步。

输出的乐谱是机器估计的 MIDI 事件，不是保证准确的出版级五线谱或真实分轨。应用不会生成新伴奏，只保留用户上传的原曲作为视频音轨。

## 文件与隐私

上传的歌曲只在浏览器内解码，并发送到本机 127.0.0.1 服务分析；服务器只监听回环地址。分离轨道、乐谱和模型权重保存在 .runtime/，不会被提交到 Git。请勿把含有私人信息的音乐或结果发布到公开仓库。

## 素材与许可

应用源码依照 MIT License 发布。assets/*.png 是为这个 Demo 制作的猫咪与乐器合成图，参考图由项目创建者提供并经 ImageGen 改绘；它们用于复现本项目舞台，不代表对参考图或其原始角色的权利主张。具体美术说明见 assets/ART-DIRECTION.md。当前舞台使用的素材一并依照仓库 MIT License 开放；公开再分发时请保留出处与本说明。

## 故障排查

- 健康状态未就绪：确认安装脚本成功完成，再运行启动入口；查看 .runtime/server.log 获取本机错误日志。
- 模型首次加载失败：检查网络连接、磁盘空间，再次点击转译；权重会保存在 .runtime/models/。
- 端口被占用：关闭之前打开的本机服务，或结束占用 8766 的旧进程，再启动。
- 录制失败：使用最新版桌面 Chrome/Edge，避免页面进入后台；确保磁盘空间充足。

## 主要组件

- Demucs — https://github.com/facebookresearch/demucs
- Spotify Basic Pitch — https://github.com/spotify/basic-pitch
- Web Audio API、Canvas 与 MediaRecorder — 本地播放、动画和 WebM 导出