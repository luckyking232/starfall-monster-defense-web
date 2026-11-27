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
  frame?: number;
  impactFamily?: string;
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
  stop(when?: number): void;
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
  keepBuffers: boolean;
  oneShot?: { frame: number; requestedAt: number; family?: string; when?: number };
  retiring?: true;
}

const MAX_SFX_GAIN = 0.10;
const SFX_FRAME_HZ = 30;
const SFX_SCHEDULING_LEAD = 0.010;
const SFX_MAX_AGE_MS = 120;
const SFX_LATE_SECONDS = 0.025;
const IMPACT_TAILS = 3;
const IMPACT_FADE_SECONDS = 0.015;

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
  private readonly musicBuffers = new Map<string, Promise<AudioBuffer>>();
  private readonly musicLoads = new AbortController();
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
  private sfxAnchor: { frame: number; when: number } | undefined;
  private readonly latestImpactFrame = new Map<string, number>();
  private readonly volumes = { bgm: 1, sfx: MAX_SFX_GAIN };
  private readonly outputs = new Map<GameAudioCue['kind'], GainNode>();

  setVolumes(music: number, effects: number): void {
    const wasMuted = this.volumes.bgm === 0;
    this.volumes.bgm = Math.max(0, Math.min(1, music));
    this.volumes.sfx = Math.max(0, Math.min(1, effects)) * MAX_SFX_GAIN;
    for (const [kind, gain] of this.outputs) gain.gain.value = this.volumes[kind];
    if (wasMuted && this.volumes.bgm > 0 && this.bgm !== null) {
      const voice = this.voices.get(this.bgm);
      if (voice) void this.start(voice).catch((error: unknown) => this.options.onError?.(error));
    }
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

  private contextForPlayback(): PlaybackContext {
    return this.context ??= (this.options.createContext ?? (() => new AudioContext()))();
  }

  /** Call directly from a trusted pointer or keyboard event. */
  async unlock(): Promise<void> {
    if (this.closing) return;
    if (this.unlocked) return this.syncVisibility();
    if (!this.unlocking) {
      const context = this.contextForPlayback();
      this.unlocking = context.resume().then(() => {
        if (this.closing) return;
        this.unlocked = true;
        return this.syncVisibility();
      }).finally(() => { this.unlocking = null; });
    }
    await this.unlocking;
  }

  async play(cue: GameAudioCue): Promise<void> {
    const { frame, impactFamily: family } = cue;
    let oneShot: Voice['oneShot'];
    if (cue.kind === 'sfx' && !cue.loop && frame !== undefined) {
      if (family) {
        const previous = this.latestImpactFrame.get(family);
        if (previous !== undefined && frame <= previous) return;
        this.latestImpactFrame.set(family, frame);
      }
      oneShot = { frame, requestedAt: performance.now(), ...(family ? { family } : {}) };
    }
    return this.playVoice(cue.id, cue.kind, [{
      ...cue,
      startOffsetSeconds: 0,
      loop: cue.loop ?? (cue.kind === 'bgm'),
    }], false, oneShot);
  }

  async playMusic(cue: GameAudioMusicCue): Promise<void> {
    if (cue.layers.length === 0) throw new RangeError('Music requires at least one audio layer');
    const layers = cue.layers.map((layer) => {
      checkLayerTiming(layer);
      return { ...layer };
    });
    return this.playVoice(cue.id, 'bgm', layers, true);
  }

  /** Decode the music in advance without unlocking or starting any voices. */
  async prepareMusic(cue: GameAudioMusicCue): Promise<void> {
    if (this.closing || this.volumes.bgm === 0) return;
    const context = this.contextForPlayback();
    await Promise.all(cue.layers.map(layer => this.bufferFor(context, layer.url, true)));
  }

  private async playVoice(id: GameAudioId, kind: GameAudioCue['kind'], layers: readonly GameAudioMusicLayer[],
    keepBuffers = false, oneShot?: Voice['oneShot']): Promise<void> {
    if (this.closing) return;
    if (kind === 'bgm' && this.bgm !== null) this.stop(this.bgm);
    this.stop(id);
    if (kind === 'bgm') this.bgm = id;
    const voice: Voice = { id, kind, layers, sources: new Map(), starting: false, keepBuffers,
      ...(oneShot ? { oneShot } : {}) };
    this.voices.set(id, voice);
    await this.start(voice);
  }

  stop(id: GameAudioId): void {
    const voice = this.voices.get(id);
    if (voice) this.remove(voice);
  }

  setSpeed(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Audio playback rate must be positive');
    if (rate !== this.sfxRate) this.sfxAnchor = undefined;
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
    this.sfxAnchor = undefined;
    this.latestImpactFrame.clear();
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
      this.musicLoads.abort();
      this.musicBuffers.clear();
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

  private canStart(voice: Voice): boolean {
    return this.canPlay() && (voice.kind === 'sfx' || this.volumes.bgm > 0);
  }

  private scheduleSfx(context: PlaybackContext, frame: number): number | undefined {
    const now = context.currentTime;
    const anchor = this.sfxAnchor;
    if (anchor?.frame === frame) return anchor.when;
    const gap = anchor ? frame - anchor.frame : 0;
    const next = anchor && gap > 0 && gap <= 4 ? anchor.when + gap / (SFX_FRAME_HZ * this.sfxRate) : 0;
    if (next - now > SFX_MAX_AGE_MS / 1000) return undefined;
    const when = Math.max(now + SFX_SCHEDULING_LEAD, next);
    this.sfxAnchor = { frame, when };
    return when;
  }

  private expired(voice: Voice): boolean {
    return voice.oneShot !== undefined && performance.now() - voice.oneShot.requestedAt > SFX_MAX_AGE_MS;
  }

  private async start(voice: Voice): Promise<void> {
    const context = this.context;
    if (!context || !this.canStart(voice) || voice.starting || voice.sources.size) return;
    const cue = voice.oneShot;
    if (cue) {
      if (this.expired(voice)) {
        this.remove(voice);
        return;
      }
      const when = cue.when ?? this.scheduleSfx(context, cue.frame);
      if (when === undefined) {
        this.remove(voice);
        return;
      }
      cue.when = when;
    }
    voice.starting = true;
    try {
      const layers = await Promise.all(voice.layers.map(async (layer) => ({
        layer,
        buffer: await this.bufferFor(context, layer.url, voice.keepBuffers),
      })));
      if (this.voices.get(voice.id) !== voice || !this.canStart(voice)) return;
      const now = context.currentTime;
      const planned = cue?.when ?? now;
      // A cold sample can resolve several requests together. Keep the newest
      // impact if their intended onsets already passed while it was decoding.
      if (this.expired(voice) || (cue?.family && now - planned > SFX_LATE_SECONDS &&
          (this.latestImpactFrame.get(cue.family) ?? cue.frame) > cue.frame)) {
        this.remove(voice);
        return;
      }
      const anchor = Math.max(now, planned);
      if (cue) cue.when = anchor;
      for (const { layer, buffer } of layers) {
        this.startLayer(context, voice, layer, buffer, anchor + layer.startOffsetSeconds);
      }
      if (cue?.family) this.fadeExcessImpact(cue.family);
    } catch (error) {
      if (this.voices.get(voice.id) !== voice) return;
      this.remove(voice);
      throw error;
    } finally {
      voice.starting = false;
    }
  }

  private fadeExcessImpact(family: string): void {
    const active = [...this.voices.values()]
      .filter(voice => voice.oneShot?.family === family && !voice.retiring && voice.sources.size > 0)
      .sort((a, b) => a.oneShot!.when! - b.oneShot!.when!);
    if (active.length <= IMPACT_TAILS) return;
    const oldest = active[0]!;
    const when = active[IMPACT_TAILS]!.oneShot!.when!;
    oldest.retiring = true;
    for (const [source, gain] of oldest.sources) {
      gain?.gain.setValueAtTime(gain.gain.value, when);
      gain?.gain.linearRampToValueAtTime(0, when + IMPACT_FADE_SECONDS);
      source.stop(when + IMPACT_FADE_SECONDS);
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
    const gain = layer.gainDb !== undefined || voice.oneShot?.family ? context.createGain?.() : undefined;
    const output = this.output(context, voice.kind);
    if (gain) {
      gain.gain.value = Math.pow(10, (layer.gainDb ?? 0) / 20);
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

  private bufferFor(context: PlaybackContext, url: string, keep = false): Promise<AudioBuffer> {
    const buffers = keep ? this.musicBuffers : this.buffers;
    const cached = buffers.get(url);
    if (cached) return cached;
    const { signal } = keep ? this.musicLoads : this.sceneLoads;
    const pending = this.loadBytes(url, signal).then((bytes) => {
      signal.throwIfAborted();
      return context.decodeAudioData(bytes).then(buffer => {
        signal.throwIfAborted();
        return buffer;
      });
    });
    buffers.set(url, pending);
    void pending.catch(() => {
      if (buffers.get(url) === pending) buffers.delete(url);
    });
    return pending;
  }
}
