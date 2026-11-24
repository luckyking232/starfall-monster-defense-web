import {authoredWallHpClip} from '../stage1-hp-autosize/hp-clip.mjs';
const ROOT='HUD/Main/Bottom/BuildHP/HPTxt';
export function finiteWallClip(stageId,c,metrics,xOrigins){
 if(c.path!==ROOT)return c.rect;
 if(!Number.isSafeInteger(stageId)||stageId<78000002||stageId>78000020)throw Error('Unqualified finite HPTxt stage');
 const max=stageId<=78000006?5000:stageId<=78000018?6000:7500;
 const runs=c.runs;
 const text=runs?.length===1&&runs[0].text;
 const match=typeof text==='string'&&/^(0|[1-9][0-9]{0,3})\/(5000|6000|7500)$/u.exec(text);
 if(!match||Number(match[2])!==max||Number(match[1])>max)throw Error('Finite HPTxt denominator or HP outside exact stage');
 // Only normalize labels for the existing shape/geometry guard; metrics are those of
 // the actual original full label. Never change any command or glyph sent to Canvas.
 return authoredWallHpClip({...c,runs:[{...runs[0],text:(+match[1]>5000?'5000':match[1])+'/5000'}]},metrics,xOrigins);
}
