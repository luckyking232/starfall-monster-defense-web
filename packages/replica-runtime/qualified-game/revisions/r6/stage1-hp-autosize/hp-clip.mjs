/** Stage1 HPTxt only: avoid treating serialized AutoSize.Both initial size as a permanent scissor.
 * The existing authored reference text origin, font, stroke, and y clip remain unchanged.
 * This says nothing about Unity device pivot or glyph rasterization. */
const path='HUD/Main/Bottom/BuildHP/HPTxt';
const exact=[284,473,76,28];
export function authoredWallHpClip(command,metrics,xOrigins){
 const r=command.rect;
 if(command.path!==path)return r;
 const s=command.style,[x,y,w,h]=r;
 if(!r.every((p,i)=>p===exact[i])||r.length!==4||command.kind!=='native-face-text'||
    s?.fontRef!=='SOURCEHANSANSSC-NORMAL-2'||s.autoSize!==1||s.align!==0||s.verticalAlign!==0||
    s.fontSize!==19||s.stroke?.size!==2||command.runs.length!==1||
    !/^(?:0|[1-9][0-9]{0,3})\/5000$/u.test(command.runs[0].text)||Number(command.runs[0].text.split('/')[0])>5000||
    xOrigins.length!==1||xOrigins[0]!==x||metrics.length!==1)
   throw Error('Stage1 HPTxt original field or anchor changed');
 const m=metrics[0];
 if(![m?.width,m?.actualBoundingBoxLeft,m?.actualBoundingBoxRight].every(Number.isFinite)||
    m.width<=0||m.width>100||Math.abs(m.actualBoundingBoxLeft)>100||Math.abs(m.actualBoundingBoxRight)>100)
   throw Error('Exact Stage1 wall text metrics unavailable');
 const start=Math.min(x,Math.floor(x-m.actualBoundingBoxLeft-s.stroke.size));
 const end=Math.max(x+w,Math.ceil(x+Math.max(m.width,m.actualBoundingBoxRight)+s.stroke.size));
 return [start,y,end-start,h];
}
