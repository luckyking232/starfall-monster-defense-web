export type GameAudioId = string | number;

export interface GameAudioCue {
  sourceOffsetSeconds?: number;
  durationSeconds?: number;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  id: GameAudioId;
  url: string;
  kind: 'bgm' | 'sfx';
  loop?: boolean;
}

export interface GameAudioMusicLayer {
  durationSeconds?: number;
  gainDb?: number;
  url: string;
  startOffsetSeconds: number;
  sourceOffsetSeconds?: number;
  loop?: boolean;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
}

export interface GameAudioMusicCue {
  id: GameAudioId;
  layers: readonly GameAudioMusicLayer[];
}

interface AudioSource {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: Pick<AudioParam, 'value'>;
  onended: ((event: Event) => void) | null;
  connect(destination: AudioNode): unknown;
  disconnect(): void;
  start(when: number, offset: number, duration?: number): void;
  stop(): void;
}

interface PlaybackContext extends Pick<AudioContext, 'currentTime' | 'destination' | 'state' | 'resume' | 'suspend' | 'close'> {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioSource;
  createGain?(): GainNode;
}

interface GameAudioOptions {
  createContext?: () => PlaybackContext;
  loadBytes?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  onError?: (error: unknown) => void;
}

interface Voice {
  id: GameAudioId;
  kind: GameAudioCue['kind'];
  layers: readonly GameAudioMusicLayer[];
  sources: Map<AudioSource, GainNode | undefined>;
  starting: boolean;
}

async function fetchAudio(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load audio ${url} (HTTP ${response.status})`);
  return response.arrayBuffer();
}

function checkLayerTiming(layer: GameAudioMusicLayer): void {
  const { startOffsetSeconds, sourceOffsetSeconds = 0, loopStartSeconds = 0, loopEndSeconds } = layer;
  const times = [startOffsetSeconds, sourceOffsetSeconds, loopStartSeconds, loopEndSeconds ?? 0];
  if (times.some((seconds) => !Number.isFinite(seconds) || seconds < 0)) {
    throw new RangeError('Audio layer times must be finite and nonnegative');
  }
  if (loopEndSeconds !== undefined && loopEndSeconds <= loopStartSeconds) {
    throw new RangeError('Audio loop end must follow its start');
  }
}

export class GameAudio {
  private readonly voices = new Map<GameAudioId, Voice>();
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly visibility;
  private readonly loadBytes;
  private sceneLoads = new AbortController();
  private context: PlaybackContext | null = null;
  private contextWork = Promise.resolve();
  private unlocking: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private unlocked = false;
  private backgrounded: boolean;
  private sfxRate = 1;
  private readonly volumes = { bgm: 1, sfx: 0.2 };
  private readonly outputs = new Map<GameAudioCue['kind'], GainNode>();

  setVolumes(music: number, effects: number): void {
    this.volumes.bgm = Math.max(0, Math.min(1, music));
    this.volumes.sfx = Math.max(0, Math.min(1, effects));
    for (const [kind, gain] of this.outputs) gain.gain.value = this.volumes[kind];
  }

  private output(context: PlaybackContext, kind: GameAudioCue['kind']): AudioNode {
    let node = this.outputs.get(kind);
    if (!node && context.createGain) {
      node = context.createGain();
      node.gain.value = this.volumes[kind];
      node.connect(context.destination);
      this.outputs.set(kind, node);
    }
    return node ?? context.destination;
  }
  private bgm: GameAudioId | null = null;

  constructor(private readonly options: GameAudioOptions = {}) {
    this.loadBytes = options.loadBytes ?? fetchAudio;
    this.visibility = options.document ?? (typeof document === 'undefined' ? undefined : document);
    this.backgrounded = this.visibility?.hidden ?? false;
    this.visibility?.addEventListener('visibilitychange', this.onVisibility);
  }

  private readonly onVisibility = () => {
    const hidden = this.visibility?.hidden ?? false;
    void this.setBackgrounded(hidden).catch((error: unknown) => this.options.onError?.(error));
  };

  /** Call directly from a trusted pointer or keyboard event. */
  async unlock(): Promise<void> {
    if (this.closing) return;
    if (this.unlocked) return this.syncVisibility();
    if (!this.unlocking) {
      const context = this.context ??= (this.options.createContext ?? (() => new AudioContext()))();
      this.unlocking = context.resume().then(() => {
        if (this.closing) return;
        this.unlocked = true;
        return this.syncVisibility();
      }).finally(() => { this.unlocking = null; });
    }
    await this.unlocking;
  }

  async play(cue: GameAudioCue): Promise<void> {
    return this.playVoice(cue.id, cue.kind, [{
      ...cue,
      startOffsetSeconds: 0,
      loop: cue.loop ?? (cue.kind === 'bgm'),
    }]);
  }

  async playMusic(cue: GameAudioMusicCue): Promise<void> {
    if (cue.layers.length === 0) throw new RangeError('Music requires at least one audio layer');
    const layers = cue.layers.map((layer) => {
      checkLayerTiming(layer);
      return { ...layer };
    });
    return this.playVoice(cue.id, 'bgm', layers);
  }

  private async playVoice(id: GameAudioId, kind: GameAudioCue['kind'], layers: readonly GameAudioMusicLayer[]): Promise<void> {
    if (this.closing) return;
    if (kind === 'bgm' && this.bgm !== null) this.stop(this.bgm);
    this.stop(id);
    if (kind === 'bgm') this.bgm = id;
    const voice: Voice = { id, kind, layers, sources: new Map(), starting: false };
    this.voices.set(id, voice);
    await this.start(voice);
  }

  stop(id: GameAudioId): void {
    const voice = this.voices.get(id);
    if (voice) this.remove(voice);
  }

  setSpeed(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Audio playback rate must be positive');
    this.sfxRate = rate;
    for (const voice of this.voices.values()) {
      if (voice.kind === 'sfx') {
        for (const source of voice.sources.keys()) source.playbackRate.value = rate;
      }
    }
  }

  setBackgrounded(hidden: boolean): Promise<void> {
    this.backgrounded = hidden;
    return this.syncVisibility();
  }

  stopAll(): void {
    for (const voice of this.voices.values()) this.remove(voice);
    this.sceneLoads.abort();
    this.sceneLoads = new AbortController();
    this.buffers.clear();
  }

  dispose(): Promise<void> {
    if (!this.closing) {
      this.closing = this.contextWork.then(async () => {
        if (this.context && this.context.state !== 'closed') await this.context.close();
      });
      this.visibility?.removeEventListener('visibilitychange', this.onVisibility);
      this.stopAll();
    }
    return this.closing;
  }

  private syncVisibility(): Promise<void> {
    const next = this.contextWork.then(async () => {
      const context = this.context;
      if (!context || !this.unlocked || this.closing) return;
      if (this.backgrounded) {
        if (context.state === 'running') await context.suspend();
      } else if (context.state !== 'running') {
        await context.resume();
      }
    });
    this.contextWork = next.catch(() => undefined);
    return next.then(async () => {
      if (!this.canPlay()) return;
      await Promise.all([...this.voices.values()].map((voice) =>
        this.start(voice).catch((error: unknown) => this.options.onError?.(error)),
      ));
    });
  }

  private canPlay(): boolean {
    return !this.closing && this.unlocked && !this.backgrounded && this.context?.state === 'running';
  }

  private async start(voice: Voice): Promise<void> {
    const context = this.context;
    if (!context || !this.canPlay() || voice.starting || voice.sources.size) return;
    voice.starting = true;
    try {
      const layers = await Promise.all(voice.layers.map(async (layer) => ({
        layer,
        buffer: await this.bufferFor(context, layer.url),
      })));
      if (this.voices.get(voice.id) !== voice || !this.canPlay()) return;
      const anchor = context.currentTime;
      for (const { layer, buffer } of layers) {
        this.startLayer(context, voice, layer, buffer, anchor + layer.startOffsetSeconds);
      }
    } catch (error) {
      if (this.voices.get(voice.id) !== voice) return;
      this.remove(voice);
      throw error;
    } finally {
      voice.starting = false;
    }
  }

  private startLayer(
    context: PlaybackContext, voice: Voice, layer: GameAudioMusicLayer, buffer: AudioBuffer, when: number,
  ): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = layer.loop ?? (voice.kind === 'bgm');
    source.loopStart = layer.loopStartSeconds ?? 0;
    source.loopEnd = layer.loopEndSeconds ?? 0;
    source.playbackRate.value = voice.kind === 'sfx' ? this.sfxRate : 1;
    const gain = layer.gainDb !== undefined ? context.createGain?.() : undefined;
    const output = this.output(context, voice.kind);
    if (gain) {
      gain.gain.value = Math.pow(10,layer.gainDb!/20);
      gain.connect(output);
    }
    source.connect(gain ?? output);
    source.onended = () => {
      gain?.disconnect();
      if (!voice.sources.delete(source)) return;
      source.onended = null;
      source.disconnect();
      if (!voice.sources.size) this.remove(voice);
    };
    try {
      if (layer.durationSeconds !== undefined && !source.loop) source.start(when,layer.sourceOffsetSeconds ?? 0,layer.durationSeconds);
      else source.start(when, layer.sourceOffsetSeconds ?? 0);
    } catch (error) {
      source.onended = null;
      source.disconnect();
      gain?.disconnect();
      throw error;
    }
    voice.sources.set(source, gain);
  }

  private remove(voice: Voice): void {
    if (this.voices.get(voice.id) !== voice) return;
    this.voices.delete(voice.id);
    if (this.bgm === voice.id) this.bgm = null;
    for (const [source, gain] of voice.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
      gain?.disconnect();
    }
    voice.sources.clear();
  }

  private bufferFor(context: PlaybackContext, url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    const { signal } = this.sceneLoads;
    const pending = this.loadBytes(url, signal).then((bytes) => {
      signal.throwIfAborted();
      return context.decodeAudioData(bytes);
    });
    this.buffers.set(url, pending);
    void pending.catch(() => {
      if (this.buffers.get(url) === pending) this.buffers.delete(url);
    });
    return pending;
  }
}
