/** Preserves the state touched by reconstructed blur/presenter. Each active texture slot is explicit. */
export const capabilities=gl=>[gl.BLEND,gl.DITHER,gl.CULL_FACE,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.RASTERIZER_DISCARD];
const store=gl=>[gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
 gl.UNPACK_ALIGNMENT,gl.UNPACK_ROW_LENGTH,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS,
 gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS];
export function captureGlState(gl,additional=[]){
 const g=p=>gl.getParameter(p), active=g(gl.ACTIVE_TEXTURE);
 const units=[...new Set([active,...additional.map(x=>gl.TEXTURE0+x)])];
 const s={active,viewport:g(gl.VIEWPORT),vao:g(gl.VERTEX_ARRAY_BINDING),pg:g(gl.CURRENT_PROGRAM),
  draw:g(gl.DRAW_FRAMEBUFFER_BINDING),read:g(gl.READ_FRAMEBUFFER_BINDING),array:g(gl.ARRAY_BUFFER_BINDING),
  unpack:g(gl.PIXEL_UNPACK_BUFFER_BINDING),pack:g(gl.PIXEL_PACK_BUFFER_BINDING),color:g(gl.COLOR_WRITEMASK),
  caps:capabilities(gl).map(x=>[x,gl.isEnabled(x)]),pixel:store(gl).map(x=>[x,g(x)]),textures:[]};
 for(const u of units){gl.activeTexture(u);s.textures.push([u,g(gl.TEXTURE_BINDING_2D),g(gl.SAMPLER_BINDING)]);}
 gl.activeTexture(active);return s;
}
export function restoreGlState(gl,s){
 for(const [u,tex,sampler] of s.textures){gl.activeTexture(u);gl.bindTexture(gl.TEXTURE_2D,tex);gl.bindSampler(u-gl.TEXTURE0,sampler);}
 gl.activeTexture(s.active);
 gl.viewport(...s.viewport);gl.bindVertexArray(s.vao);gl.useProgram(s.pg);
 gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,s.draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,s.read);
 gl.bindBuffer(gl.ARRAY_BUFFER,s.array);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,s.unpack);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,s.pack);
 gl.colorMask(...s.color);
 for(const [k,v] of s.caps)v?gl.enable(k):gl.disable(k);
 for(const [k,v] of s.pixel)gl.pixelStorei(k,v);
}
