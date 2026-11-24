"""Add a future explicit local-save variant; the default archived preflight stays immutable."""
from pathlib import Path
H=Path(__file__).resolve().parent
STORAGE='/_portable/progress-store.mjs'
SESSION='/qualified-game/revisions/r6/site/session.mjs'
UI='/qualified-game/revisions/r6/cloud-temporary-20108-cpu/ui.mjs'
def one(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
def future(chosen,source,baseline):
 if chosen==SESSION:
  assert baseline=='ec08e105190693ba0f20f30657780f61007fb5e3559a986c544d4eff0b2228f0'
  s="import {isProgressStore} from '../../../../_portable/progress-store.mjs';\n"+source
  s=one(s,'WorkerClass,preferredSpeed=1}={}','WorkerClass,preferredSpeed=1,progressStore=null}={}')
  s=one(s,"  if(![1,2].includes(preferredSpeed))","  if(progressStore!==null&&!isProgressStore(progressStore)) throw fail('progress-scope','Only scoped local progress capability is supported');\n  if(![1,2].includes(preferredSpeed))")
  # Stored state is distinct from external activity score. Initialization accepts only the
  # stock local activity and only a strict saved finite range; existing authenticated gate remains.
  s=one(s,"    const nextScore=Math.max(same?localHighScore:0,miniHighScore);","""    if(progressStore&&(activityId!==70060517||miniHighScore!==0))throw fail('progress-scope','Private saves only accept the original local activity with external score zero');
    const retrieved=!activity&&progressStore?progressStore.load():null;
    const restored=int(retrieved?.score,STAGE,78000020)?retrieved.score:0;
    const nextScore=Math.max(same?localHighScore:restored,miniHighScore);""")
  s=one(s,"    if(!same) localHighScore=0;","    if(!same) localHighScore=restored;")
  s=one(s,"""      if(status==='success' && settlement.cause==='natural' && settlement.offer.request.point===activeStage)
        localHighScore=Math.max(localHighScore,activeStage);""","""      if(status==='success' && settlement.cause==='natural' && settlement.offer.request.point===activeStage){
        localHighScore=Math.max(localHighScore,activeStage);
        if(progressStore&&activity?.activityId===70060517&&activity.miniHighScore===0&&
          battle?.terminal?.win===true&&battle.terminal.loss===false&&int(activeStage,STAGE,78000020))
          progressStore.commit(activeStage);
      }""")
  return s
 if chosen==UI:
  s="import {openProgressStore} from '../../../../_portable/progress-store.mjs';\n"+source
  s=one(s,'let world=null;',"""let world=null;
const progressStore=openProgressStore(__p.base);
function progressCopy(localScore){
 const p=progressStore.status;
 if(p.mode==='unreadable')return '此路径的本地进度记录不完整。未清除或覆盖；只使用可校验记录。';
 if(p.mode!=='local')return '此浏览器未保存进度；本次进度只留在当前页面。';
 if(p.score!==localScore)return '本次进度尚未保存；请勿关闭当前页面。';
 return p.score===0?'此路径可在首次胜利结算后保存本地进度。':'已保存到本浏览器的此路径：第 '+(p.score%100)+' 关通关。';
}""")
  s=one(s,"s.result?.kind==='error'?s.result.text:''].filter","s.result?.kind==='error'?s.result.text:'',progressCopy(s.localHighScore)].filter")
  s=one(s,"WorkerClass:world?.WorkerClass});","WorkerClass:world?.WorkerClass,progressStore});")
  return s
 return source
