/** Source FUI relationship projection for design-width or wider viewports. */
const [W,H]=[1334,750];
const freeze=Object.freeze;
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const ensure=(ok,msg)=>{if(!ok)throw new RangeError(msg);};
const axes=new Set(['left','center','right','screen']);
export function geometry(width,height,{hudInsets=null}={}){
  ensure(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width*height<=16*1024*1024,'unsupported framebuffer');
  const full=freeze([0,0,width,height]);
  if(width*H<height*W)return freeze({width,height,full,held:'narrow-view-fui-scaling-unproved'});
  const scale=height/H, center=(width-W*scale)/2;
  let edges=null;
  if(hudInsets!==null){
    const [left,right]=[hudInsets.left,hudInsets.right];
    ensure(valid(left)&&valid(right)&&left>=0&&right>=0&&width-left-right>=W*scale-1e-7,'HUD effective edges too narrow or invalid');
    edges=freeze({left,right:width-right});
  }
  const origin=(plane,anchor)=>{
    ensure(['modal','hud'].includes(plane)&&axes.has(anchor),'unknown FUI relation');
    ensure(plane!=='modal'||anchor==='center'||anchor==='screen','invalid modal anchor');
    if(anchor==='screen')return 0;
    if(plane==='modal'||anchor==='center')return center;
    ensure(edges,'external HUD safe-area edges unproved');
    return anchor==='left'?edges.left:edges.right-W*scale;
  };
  const point=(plane,anchor,x,y)=>{
    ensure(valid(x)&&valid(y),'invalid logical point');
    return freeze([origin(plane,anchor)+x*scale,y*scale]);
  };
  const rect=(plane,anchor,x,y,w,h)=>{
    ensure(valid(w)&&valid(h)&&w>=0&&h>=0,'invalid logical size');
    return freeze([...point(plane,anchor,x,y),w*scale,h*scale]);
  };
  const inverse=(plane,anchor,x,y)=>{
    ensure(valid(x)&&valid(y),'invalid framebuffer point');
    return freeze([(x-origin(plane,anchor))/scale,y/scale]);
  };
  const hit=(plane,anchor,clientX,clientY,bounds)=>{
    const [l,t,w,h]=[bounds?.left,bounds?.top,bounds?.width,bounds?.height];
    ensure([l,t,w,h,clientX,clientY].every(valid)&&w>0&&h>0,'invalid CSS hit viewport');
    if(clientX<l||clientY<t||clientX>=l+w||clientY>=t+h)return null;
    return inverse(plane,anchor,(clientX-l)*width/w,(clientY-t)*height/h);
  };
  return freeze({width,height,full,scale,center,edges,point,rect,inverse,hit});
}

/**
 * An opt-in private composition surface for independent canvases.
 * The world renderer may use WebGL; HUD and modal canvases stay Canvas2D.
 * World and HUD under a modal are hidden unless a separately qualified
 * native-background compositor is explicitly supplied; never fake blur.
 */
export function createLayerPlanes({container,world,hud,modal}){
  ensure(container&&typeof container.append==='function'&&container.style,'missing layers host');
  ensure(new Set([world,hud,modal]).size===3&&[world,hud,modal].every(c=>c?.style&&typeof c.getContext==='function'),'three independent canvases required');
  Object.assign(container.style,{position:'relative',overflow:'hidden'});
  for(const [i,c] of [world,hud,modal].entries())Object.assign(c.style,{
    position:'absolute',inset:'0',width:'100%',height:'100%',zIndex:String(i),
    pointerEvents:'none',visibility:'hidden',
  });
  container.append(world,hud,modal);
  let g,active,disposed=false;
  const context=c=>{const ctx=c.getContext('2d');ensure(ctx,'Canvas2D plane unavailable');return ctx;};
  const paint2d=(c,fn)=>{
    const ctx=context(c);
    ctx.save();
    try{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,g.width,g.height);fn?.(ctx,g);}
    finally{ctx.restore();}
  };
  return freeze({
    resize(w,h,opts){
      ensure(!disposed,'layer surface disposed');
      g=geometry(w,h,opts);active=null;
      container.style.aspectRatio=w+' / '+h;
      for(const c of [world,hud,modal]){
        c.style.visibility='hidden';if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;
      }
      return g;
    },
    draw({world:drawWorld,hud:drawHud,modal:drawModal,qualifiedBackground}={}){
      ensure(!disposed&&g,'resize before rendering');
      active=null;
      for(const c of [world,hud,modal])c.style.visibility='hidden';
      if(g.held)return freeze({held:[g.held]});
      const held=[];
      if(drawModal){
        if(qualifiedBackground){
          // Trusted, independently proven native composition supplied by caller.
          qualifiedBackground(world,g);
          world.style.visibility='visible';
        }else held.push('native-modal-background-unproved');
        paint2d(modal,drawModal);modal.style.visibility='visible';active='modal';
      }else{
        if(drawWorld){drawWorld(world,g);world.style.visibility='visible';}
        if(drawHud&&g.edges){
          paint2d(hud,drawHud);hud.style.visibility='visible';active='hud';
        }else if(drawHud)held.push('external-hud-safe-area-unproved');
      }
      return freeze({held:freeze(held)});
    },
    hit(plane,anchor,x,y){
      if(disposed||plane!==active)return null;
      return g.hit(plane,anchor,x,y,container.getBoundingClientRect());
    },
    dispose(){
      if(disposed)return;
      disposed=true;active=null;
      for(const c of [world,hud,modal])c.remove();
    },
  });
}
