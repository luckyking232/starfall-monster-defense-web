import evidence from '../../runtime/audio-cues.json';
import { assetUrl } from '../platform/assets';
import type { UiEvent } from '../../runtime/ui/protocol';
import { GameAudio, type GameAudioMusicCue } from './game-audio';

interface Sample { file:string; offset:number; weight:number }
interface EventCue { samples?:Sample[]; duration?:number; loop?:number[]; stop?:string }
const effects: Record<string,EventCue> = evidence.effects;
const hz=evidence.clockHz;
const asset=(file:string)=>assetUrl('audio/'+file).href;

function musicCue(): GameAudioMusicCue {
  return { id:'bgm', layers:evidence.music.layers.map(l=>({ url:asset(l.file), startOffsetSeconds:l.start/hz,
    sourceOffsetSeconds:l.offset/hz, loopStartSeconds:l.loopFrom/hz, loopEndSeconds:l.loopTo/hz, gainDb:l.gainDb })) };
}

export class BattleAudio {
  private readonly player=new GameAudio({onError:this.report});
  private readonly loops=new Map<string,Set<number>>();
  private readonly onGesture=()=>{void this.player.unlock().catch(this.report);};
  private report(error:unknown):void { console.warn('战斗声音播放失败',error); }

  constructor() {
    document.addEventListener('pointerdown',this.onGesture,{capture:true});
    document.addEventListener('keydown',this.onGesture,{capture:true});
  }

  prepareMusic(): Promise<void> { return this.player.prepareMusic(musicCue()); }

  handle(event:UiEvent):void {
    if(event.name==='audio-speed') this.player.setSpeed(event.speed);
    if(event.name==='audio-stop') {
      this.player.stop(event.id);
      for(const ids of this.loops.values()) if(typeof event.id==='number') ids.delete(event.id);
    }
    if(event.name!=='audio-play') return;
    if(event.kind==='bgm') {
      if(event.path===evidence.music.event) void this.player.playMusic(musicCue()).catch(this.report);
      return;
    }
    const cue=effects[event.path];
    if(!cue) return;
    if(cue.stop) {
      for(const id of this.loops.get(cue.stop) ?? []) this.player.stop(id);
      this.loops.delete(cue.stop);
      return;
    }
    if(!cue.samples?.length) return;
    const samples=cue.samples;
    let sample=samples[0]!;
    if(samples.length>1) {
      let draw=Math.random()*samples.reduce((sum,s)=>sum+s.weight,0);
      sample=samples.find(s=>(draw-=s.weight)<0) ?? samples[samples.length-1]!;
    }
    if(cue.loop) {
      const ids=this.loops.get(event.path) ?? new Set<number>();
      ids.add(event.id);
      this.loops.set(event.path,ids);
    }
    // Hit events use the target model as their emitter, so their original cue
    // path identifies the attack sound shared by all targets of the impact.
    void this.player.play({id:event.id,url:asset(sample.file),kind:'sfx',sourceOffsetSeconds:sample.offset/hz,
      ...(event.frame !== undefined ? {frame:event.frame} : {}),
      ...(!cue.loop && event.path.endsWith('_hit') ? {impactFamily:event.path} : {}),
      ...(cue.duration ? {durationSeconds:cue.duration/hz} : {}),
      ...(cue.loop ? {loop:true,loopStartSeconds:(cue.loop[0]!+sample.offset)/hz,loopEndSeconds:(cue.loop[1]!+sample.offset)/hz} : {})}).catch(this.report);
  }

  setVolumes(music: number, effects: number): void { this.player.setVolumes(music / 100, effects / 100); }
  clear():void { this.loops.clear(); this.player.stopAll(); }
  dispose():void {
    document.removeEventListener('pointerdown',this.onGesture,true);
    document.removeEventListener('keydown',this.onGesture,true);
    void this.player.dispose().catch(this.report);
  }
}
