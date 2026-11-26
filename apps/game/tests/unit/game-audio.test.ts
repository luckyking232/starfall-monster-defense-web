import { describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../../src/presentation/game-audio';

class TestSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = { value: 1 };
  onended: ((event: Event) => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class TestContext {
  state: AudioContextState = 'suspended';
  readonly sources: TestSource[] = [];
  readonly destination = {} as AudioDestinationNode;
  readonly resume = vi.fn(async () => { this.state = 'running'; });
  readonly suspend = vi.fn(async () => { this.state = 'suspended'; });
  readonly close = vi.fn(async () => { this.state = 'closed'; });
  readonly decodeAudioData = vi.fn(async () => ({} as AudioBuffer));
  readonly clock = vi.fn(() => 0);

  get currentTime() { return this.clock(); }

  createBufferSource() {
    const source = new TestSource();
    this.sources.push(source);
    return source;
  }
}

class TestDocument extends EventTarget {
  hidden = false;

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

const firstBgm = { id: 'first', url: 'first.wav', kind: 'bgm' } as const;
const secondBgm = { id: 'second', url: 'second.wav', kind: 'bgm' } as const;
const chime = (id: number) => ({ id, url: 'chime.wav', kind: 'sfx' } as const);
const musicCue = { id: 'layered', layers: [
  { url: 'intro.wav', startOffsetSeconds: 0 },
  { url: 'main.wav', startOffsetSeconds: 0.13425 },
] } as const;

function createAudio() {
  const context = new TestContext();
  const document = new TestDocument();
  const loadBytes = vi.fn(async (_url: string, _signal: AbortSignal) => new ArrayBuffer(8));
  return {
    audio: new GameAudio({ createContext: () => context, document, loadBytes }),
    context,
    document,
    loadBytes,
  };
}

describe('GameAudio', () => {
  it('routes active attack sounds and layered music through independent volume controls', async () => {
    const { context, audio } = createAudio();
    const gain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
    const nodes: ReturnType<typeof gain>[] = [];
    Object.assign(context, { createGain: () => { const node = gain(); nodes.push(node); return node; } });
    await audio.unlock();
    await audio.play(chime(1));
    await audio.playMusic({ id:'music', layers:[{ url:'theme.wav', gainDb:-6, startOffsetSeconds:0 }] });
    const [fx, layer, music] = nodes;
    expect(fx!.gain.value).toBeCloseTo(0.1);
    expect(layer!.gain.value).toBeCloseTo(10 ** (-6 / 20));
    expect(layer!.connect).toHaveBeenCalledWith(music);
    audio.setVolumes(0.5,0.2);
    expect(fx!.gain.value).toBeCloseTo(0.02);
    expect(music!.gain.value).toBeCloseTo(0.5);
    expect(layer!.gain.value).toBeCloseTo(10 ** (-6 / 20));
    audio.setVolumes(0,1);
    expect(fx!.gain.value).toBeCloseTo(0.1);
    expect(music!.gain.value).toBe(0);
    await audio.dispose();
  });

  it('prepares both music layers without starting audio and reuses them for another battle', async () => {
    const { audio, context, loadBytes } = createAudio();
    await Promise.all([audio.prepareMusic(musicCue), audio.prepareMusic(musicCue)]);
    expect(loadBytes.mock.calls.map(([url]) => url)).toEqual(['intro.wav', 'main.wav']);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);

    await audio.playMusic(musicCue);
    expect(context.sources).toHaveLength(0);
    await audio.unlock();
    expect(context.sources).toHaveLength(2);
    audio.stopAll();
    await audio.prepareMusic(musicCue);
    await audio.playMusic(musicCue);
    expect(loadBytes).toHaveBeenCalledTimes(2);
    expect(context.sources).toHaveLength(4);
    await audio.dispose();
  });

  it('skips muted preparation, starts deferred music on unmute, and preserves playback through later mute', async () => {
    const { audio, context, loadBytes } = createAudio();
    audio.setVolumes(0, 1);
    await audio.prepareMusic(musicCue);
    expect(loadBytes).not.toHaveBeenCalled();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    await audio.unlock();
    await audio.playMusic(musicCue);
    expect(loadBytes).not.toHaveBeenCalled();
    await audio.play(chime(1));
    expect(context.sources).toHaveLength(1);

    audio.setVolumes(1, 1);
    await vi.waitFor(() => expect(context.sources).toHaveLength(3));
    expect(loadBytes).toHaveBeenCalledTimes(3);
    audio.setVolumes(0, 1);
    audio.setVolumes(1, 1);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[1]?.stop).not.toHaveBeenCalled();
    await audio.dispose();
  });

  it('retries only a failed music layer and keeps in-flight music through a scene change', async () => {
    const { audio, context, loadBytes } = createAudio();
    loadBytes.mockRejectedValueOnce(new Error('offline'));
    await expect(audio.prepareMusic(musicCue)).rejects.toThrow('offline');
    let finish!: (bytes: ArrayBuffer) => void;
    loadBytes.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const retry = audio.prepareMusic(musicCue);
    const signal = loadBytes.mock.calls.at(-1)?.[1];
    audio.stopAll();
    expect(signal?.aborted).toBe(false);
    finish(new ArrayBuffer(8));
    await retry;
    expect(loadBytes.mock.calls.map(([url]) => url)).toEqual(['intro.wav', 'main.wav', 'intro.wav']);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    await audio.dispose();
    expect(signal?.aborted).toBe(true);
  });

  it('starts gated voices only after calling resume in the gesture handler', async () => {
    const { audio, context, loadBytes } = createAudio();
    await audio.play(firstBgm);
    expect(loadBytes).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);

    const unlocking = audio.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    await unlocking;
    expect(context.sources[0]?.start).toHaveBeenCalledOnce();
    expect(context.sources[0]?.loop).toBe(true);
    await audio.dispose();
  });

  it('replaces BGM and lets multiple independently stoppable SFX share one decoded buffer', async () => {
    const { audio, context, loadBytes } = createAudio();
    await audio.unlock();
    await audio.play(firstBgm);
    await audio.play(secondBgm);
    await Promise.all([audio.play(chime(1)), audio.play(chime(2))]);

    expect(context.sources).toHaveLength(4);
    expect(context.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(context.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(context.sources[1]?.loop).toBe(true);
    expect(context.sources[2]?.loop).toBe(false);
    expect(loadBytes.mock.calls.filter(([url]) => url === 'chime.wav')).toHaveLength(1);

    audio.stop(1);
    expect(context.sources[2]?.stop).toHaveBeenCalledOnce();
    expect(context.sources[3]?.stop).not.toHaveBeenCalled();
    context.sources[3]?.onended?.(new Event('ended'));
    audio.stop(2);
    expect(context.sources[3]?.stop).not.toHaveBeenCalled();
    expect(context.sources[3]?.disconnect).toHaveBeenCalledOnce();
    await audio.dispose();
  });

  it('suspends when the document hides and applies the current rate only to live and queued effects', async () => {
    const { audio, context, document } = createAudio();
    await audio.unlock();
    await audio.play(firstBgm);
    await audio.play(chime(1));
    document.setHidden(true);
    await vi.waitFor(() => expect(context.state).toBe('suspended'));

    await audio.play(chime(2));
    audio.setSpeed(2);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.playbackRate.value).toBe(1);
    expect(context.sources[1]?.playbackRate.value).toBe(2);
    expect(context.sources[0]?.stop).not.toHaveBeenCalled();
    document.setHidden(false);
    await vi.waitFor(() => expect(context.sources).toHaveLength(3));
    expect(context.state).toBe('running');
    expect(context.sources[2]?.playbackRate.value).toBe(2);
    await audio.dispose();
  });

  it('schedules all music layers against the same context time with independent sample offsets and loops', async () => {
    const { audio, context } = createAudio();
    await audio.unlock();
    context.clock.mockReturnValue(10);
    await audio.playMusic({
      id: 'layered',
      layers: [
        { url: 'intro.wav', startOffsetSeconds: 0.125, loop: false },
        {
          url: 'main.wav', startOffsetSeconds: 1.5, sourceOffsetSeconds: 0.25,
          loopStartSeconds: 0.5, loopEndSeconds: 4,
        },
      ],
    });
    expect(context.clock).toHaveBeenCalledOnce();
    const [intro, main] = context.sources;
    expect(intro?.start).toHaveBeenCalledWith(10.125, 0);
    expect(intro?.loop).toBe(false);
    expect(main?.start).toHaveBeenCalledWith(11.5, 0.25);
    expect([main?.loop, main?.loopStart, main?.loopEnd]).toEqual([true, 0.5, 4]);
    audio.setSpeed(2);
    expect([intro?.playbackRate.value, main?.playbackRate.value]).toEqual([1, 1]);

    await audio.setBackgrounded(true);
    await audio.setBackgrounded(false);
    expect(context.sources).toHaveLength(2);
    intro?.onended?.(new Event('ended'));
    expect(main?.stop).not.toHaveBeenCalled();
    audio.stop('layered');
    expect(intro?.disconnect).toHaveBeenCalledOnce();
    expect(main?.stop).toHaveBeenCalledOnce();
    expect(main?.disconnect).toHaveBeenCalledOnce();
    await audio.dispose();
  });

  it('keeps a layered track silent until every layer loads and drops it if another BGM replaces it', async () => {
    const { audio, context, loadBytes } = createAudio();
    await audio.unlock();
    let resolveLayer!: (bytes: ArrayBuffer) => void;
    loadBytes.mockImplementation((url) => url === 'slow.wav'
      ? new Promise((resolve) => { resolveLayer = resolve; })
      : Promise.resolve(new ArrayBuffer(8)));
    const starting = audio.playMusic({
      id: 'layered',
      layers: [
        { url: 'fast.wav', startOffsetSeconds: 0 },
        { url: 'slow.wav', startOffsetSeconds: 2 },
      ],
    });
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce());
    expect(context.sources).toHaveLength(0);

    await audio.play(secondBgm);
    resolveLayer(new ArrayBuffer(8));
    await starting;
    expect(context.sources).toHaveLength(1);
    await audio.dispose();
  });

  it('aborts pending scene loads, rejects stale playback, and removes document listeners on disposal', async () => {
    const { audio, context, loadBytes, document } = createAudio();
    await audio.unlock();
    let finishLoad!: (data: ArrayBuffer) => void;
    loadBytes.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
    const playing = audio.play(firstBgm);
    const signal = loadBytes.mock.calls[0]?.[1];
    audio.stopAll();
    expect(signal?.aborted).toBe(true);
    finishLoad(new ArrayBuffer(8));
    await playing;
    expect(context.sources).toHaveLength(0);

    await audio.play(secondBgm);
    await audio.dispose();
    expect(context.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(context.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    document.setHidden(true);
    expect(context.suspend).not.toHaveBeenCalled();
  });
});
