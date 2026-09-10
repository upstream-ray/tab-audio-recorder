// PCM 旁路（AudioWorklet）。
//
// 挂在捕获流上，把音频降混成单声道后攒够一批再 postMessage 给 offscreen 主线程，
// 由那边交给 lamejs 实时编码成 MP3。纯旁路：本节点不往 output 写任何数据，
// 也不碰 keepCapturedAudioAudible 那条回放链路，所以不会影响用户听到的声音。
//
// process() 每次只给 128 帧，直接逐帧回传会有每秒 375 次消息，太碎，
// 因此在这里攒到 frames（默认 4096）再一次性转移所有权发出去。
class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames = options?.processorOptions?.frames || 4096;
    this.buffer = new Float32Array(this.frames);
    this.filled = 0;
    // 默认关闸：录音真正开始之前不往外发数据。
    this.enabled = options?.processorOptions?.enabled === true;

    this.port.onmessage = (event) => {
      // 暂停录音时关闸：worklet 继续跑，但不再往外发数据。
      if (event.data?.type === 'gate') {
        this.enabled = !!event.data.enabled;
        if (!this.enabled) {
          this.filled = 0;
        }
      }
    };
  }

  process(inputs) {
    if (!this.enabled) {
      return true;
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const left = input[0];
    if (!left) {
      return true;
    }
    const right = input.length > 1 ? input[1] : null;

    for (let i = 0; i < left.length; i++) {
      this.buffer[this.filled++] = right ? (left[i] + right[i]) * 0.5 : left[i];

      if (this.filled === this.frames) {
        const batch = this.buffer.slice(0);
        this.port.postMessage(batch, [batch.buffer]);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-tap', PcmTapProcessor);
