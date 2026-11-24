/* Generated from the sealed Stage1 triangle raster; exact separate Stage2 alpha and shadow blending. */
const W=1334,H=750,f=Math.fround;
const ask=(ok,m)=>{if(!ok)throw Error(m);};
const e=(x,y,u,v,p,q)=>(u-x)*(q-y)-(v-y)*(p-x);
const border=(x,y,u,v)=>v<y||(v===y&&u>x);
const grid=256, clamp=(n,m)=>Math.max(0,Math.min(n,m-1));
export const pixel=(a,b,uv,t,xoff,yoff)=>{
 const sx=f(f(f(a[0]*f(b[0]))+f(a[2]*f(b[1])))+a[4]),sy=f(f(f(a[1]*f(b[0]))+f(a[3]*f(b[1])))+a[5]);
 const x=(f(sx/f(xoff))+1)*W/2,y=(1-f(sy/f(yoff)))*H/2;
 return [x,y,f(uv[0]/t.width),f(1-uv[1]/t.height),Math.round(x*grid),Math.round(y*grid)];
};
export function tri(rgba,t,v,budget,diag,shadow=null){
 let a=v[0],b=v[1],c=v[2],area=e(a[4],a[5],b[4],b[5],c[4],c[5]);
 if(area===0)return budget;
 if(area<0){[b,c]=[c,b];area=-area;}
 const det=e(a[0],a[1],b[0],b[1],c[0],c[1]);
 ask(det>0,'Invalid Stage1 projected triangle');
 const minX=Math.max(0,Math.ceil(Math.min(a[4],b[4],c[4])/grid-.5));
 const maxX=Math.min(W-1,Math.floor(Math.max(a[4],b[4],c[4])/grid-.5));
 const minY=Math.max(0,Math.ceil(Math.min(a[5],b[5],c[5])/grid-.5));
 const maxY=Math.min(H-1,Math.floor(Math.max(a[5],b[5],c[5])/grid-.5));
 if(maxX<minX||maxY<minY)return budget;
 budget-=(maxX-minX+1)*(maxY-minY+1);
 ask(budget>=0,'Stage2 CPU raster cost cap exceeded; keep scene withheld');
 const m=border(b[4],b[5],c[4],c[5]),n=border(c[4],c[5],a[4],a[5]),p=border(a[4],a[5],b[4],b[5]);
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const q=(x+.5)*grid,k=(y+.5)*grid;
  const i=e(b[4],b[5],c[4],c[5],q,k),j=e(c[4],c[5],a[4],a[5],q,k),l=e(a[4],a[5],b[4],b[5],q,k);
  const inside=!(i<0||(i===0&&!m)||j<0||(j===0&&!n)||l<0||(l===0&&!p));
  // An independent audit of plausible separable nearest-sample tie variants; never drives the produced raster.
  const edge=diag&&(Math.abs(i)<=3*Math.hypot(c[4]-b[4],c[5]-b[5])||
     Math.abs(j)<=3*Math.hypot(a[4]-c[4],a[5]-c[5])||Math.abs(l)<=3*Math.hypot(b[4]-a[4],b[5]-a[5]));
  if(!inside&&!edge)continue;
  const wb=e(c[0],c[1],a[0],a[1],x+.5,y+.5)/det,wc=e(a[0],a[1],b[0],b[1],x+.5,y+.5)/det;
  const su=f(a[2]+wb*(b[2]-a[2])+wc*(c[2]-a[2]))*t.width,sv=f(a[3]+wb*(b[3]-a[3])+wc*(c[3]-a[3]))*t.height;
  const tx=clamp(Math.floor(su),t.width),ty=clamp(Math.floor(sv),t.height);
  const t0=(ty*t.width+tx)*4,a0=t.rgba[t0+3],z=(y*W+x)*4;
  if(diag){
   if(edge)diag.near[z/4]|=1;
   if(inside){
    const u=Math.round(su),v=Math.round(sv),epsilon=.006;
    const us=Math.abs(su-u)<=epsilon?[clamp(u-1,t.width),clamp(u,t.width)]:[tx];
    const vs=Math.abs(sv-v)<=epsilon?[clamp(v-1,t.height),clamp(v,t.height)]:[ty];
    if(us.length+vs.length>2)diag.near[z/4]|=2;
    if((diag.near[z/4]&2)||diag.candidates.has(z/4)){
     const prior=diag.candidates.get(z/4)??new Set([rgba[z]*65536+rgba[z+1]*256+rgba[z+2]]);
     const updated=new Set();
     for(const value of prior)for(const i of us)for(const j of vs){
      const tex=(j*t.width+i)*4, alpha=t.rgba[tex+3];
      const channel=(pix,k)=>Math.round(((shadow?shadow[k]:t.rgba[tex+k])*alpha+pix*(255-alpha))/255);
      updated.add(channel((value>>16)&255,0)*65536+channel((value>>8)&255,1)*256+channel(value&255,2));
     }
     ask(updated.size<=64,'Too many possible nearest boundary alternatives for exact comparison');
     diag.candidates.set(z/4,updated);
    }
    for(let k=0;k<3;k++){
     let lo=255,hi=0;
     for(const r of us)for(const s of vs){
      const j=(s*t.width+r)*4,alpha=t.rgba[j+3],src=(shadow?shadow[k]:t.rgba[j+k])*alpha;
      lo=Math.min(lo,Math.round((src+diag.lo[z+k]*(255-alpha))/255));
      hi=Math.max(hi,Math.round((src+diag.hi[z+k]*(255-alpha))/255));
     }
     diag.lo[z+k]=lo;diag.hi[z+k]=hi;
    }
   }
  }
  if(!inside||!a0)continue;
  for(let k=0;k<3;k++)rgba[z+k]=Math.round(((shadow?shadow[k]:t.rgba[t0+k])*a0+rgba[z+k]*(255-a0))/255);
  rgba[z+3]=Math.round(((shadow?a0:255)*a0+rgba[z+3]*(255-a0))/255);
 }
 return budget;
}
