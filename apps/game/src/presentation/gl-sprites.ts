import type { PrefabSpriteCommand } from './prefab-player';

interface AtlasFrame {
  texture: WebGLTexture;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const vertexSource = `
attribute vec2 position;
attribute vec2 texcoord;
attribute float opacity;
varying vec2 uv;
varying float alpha;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  uv = texcoord;
  alpha = opacity;
}`;
const fragmentSource = `
precision highp float;
uniform sampler2D atlas;
varying vec2 uv;
varying float alpha;
void main() { gl_FragColor = texture2D(atlas, uv) * alpha; }`;

function linkSprites(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('无法建立战场精灵程序');
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('无法建立战场精灵着色器');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? '战场精灵着色器编译失败');
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? '战场精灵程序链接失败');
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
}

/** Premultiplied atlas batches. Each texture/filter run retains the supplied transparent draw order. */
export class GlSprites {
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly attributes: number[];
  private readonly sampler: WebGLUniformLocation | null;
  private readonly textures = new Map<WebGLTexture, string[]>();
  private readonly frames = new Map<string, AtlasFrame>();
  private readonly vertices = new Float32Array(256 * 6 * 5);

  constructor(private readonly gl: WebGLRenderingContext) {
    const program = this.program = linkSprites(gl);
    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      throw new Error('无法建立战场精灵顶点缓冲区');
    }
    this.buffer = buffer;
    this.attributes = ['position', 'texcoord', 'opacity'].map(name => gl.getAttribLocation(program, name));
    this.sampler = gl.getUniformLocation(program, 'atlas');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);
  }

  prepare(images: ReadonlyMap<string, HTMLImageElement>): void {
    const gl = this.gl;
    for (const [texture, files] of this.textures) {
      if (files.some(file => images.has(file))) continue;
      gl.deleteTexture(texture);
      this.textures.delete(texture);
      for (const file of files) this.frames.delete(file);
    }
    const pending = [...images].filter(([file]) => !this.frames.has(file));
    if (!pending.length) return;
    const max = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const size = Math.min(2048, max);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法建立战场精灵图集');
    pending.sort((a, b) => b[1].naturalHeight - a[1].naturalHeight);
    let page: { file: string; x: number; y: number; w: number; h: number }[] = [];
    let x = 0, y = 0, rowHeight = 0;
    const upload = () => {
      if (page.length === 0) return;
      const texture = gl.createTexture();
      if (!texture) throw new Error('无法建立战场精灵纹理');
      this.textures.set(texture, page.map(frame => frame.file));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const { width, height } = canvas;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      for (const frame of page) {
        this.frames.set(frame.file, { texture, u0: frame.x / width, v0: frame.y / height,
          u1: (frame.x + frame.w) / width, v1: (frame.y + frame.h) / height });
      }
      page = [];
      x = y = rowHeight = 0;
    };
    const resize = (width: number, height: number) => { canvas.width = width; canvas.height = height; };
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    resize(size, size);
    try {
      for (const [file, image] of pending) {
        const w = image.naturalWidth, h = image.naturalHeight;
        if (w + 2 > max || h + 2 > max) throw new Error(`战场精灵超出纹理尺寸：${file}`);
        // Keep large battlefield backgrounds on their own pages so a stage
        // change can release a map without evicting common character sprites.
        const dedicated = w >= size / 2 || w + 2 > size || h + 2 > size;
        if (dedicated) {
          upload();
          resize(w + 2, h + 2);
        } else {
          if (x + w + 2 > size) { x = 0; y += rowHeight; rowHeight = 0; }
          if (y + h + 2 > size) { upload(); resize(size, size); }
        }
        const left = x + 1, top = y + 1;
        // Extrude the edge into the gutter to keep adjacent sprites out of bilinear samples.
        ctx.drawImage(image, left, top);
        ctx.drawImage(image, 0, 0, 1, h, left - 1, top, 1, h);
        ctx.drawImage(image, w - 1, 0, 1, h, left + w, top, 1, h);
        ctx.drawImage(canvas, left - 1, top, w + 2, 1, left - 1, top - 1, w + 2, 1);
        ctx.drawImage(canvas, left - 1, top + h - 1, w + 2, 1, left - 1, top + h, w + 2, 1);
        page.push({ file, x: left, y: top, w, h });
        x += w + 2;
        rowHeight = Math.max(rowHeight, h + 2);
        if (dedicated) { upload(); resize(size, size); }
      }
      upload();
    } finally {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  draw(commands: readonly PrefabSpriteCommand[], start: number, end: number): void {
    const { gl, attributes, vertices } = this;
    gl.useProgram(this.program);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.sampler, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.vertexAttribPointer(attributes[0]!, 2, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(attributes[1]!, 2, gl.FLOAT, false, 20, 8);
    gl.vertexAttribPointer(attributes[2]!, 1, gl.FLOAT, false, 20, 16);
    for (const attribute of attributes) gl.enableVertexAttribArray(attribute);
    const scaleX = 2 / gl.drawingBufferWidth;
    const scaleY = -2 / gl.drawingBufferHeight;
    let texture: WebGLTexture | undefined, filter: number = gl.NEAREST, count = 0;
    const flush = () => {
      if (!count) return;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, count));
      gl.drawArrays(gl.TRIANGLES, 0, count / 5);
      count = 0;
    };
    const vertex = (x: number, y: number, u: number, v: number, alpha: number) => {
      vertices[count++] = x * scaleX - 1;
      vertices[count++] = y * scaleY + 1;
      vertices[count++] = u;
      vertices[count++] = v;
      vertices[count++] = alpha;
    };
    try {
      for (let index = start; index < end; index++) {
        const { frame, filterMode, quad: { topLeft, topRight, bottomLeft }, alpha } = commands[index]!;
        const tile = this.frames.get(frame.file);
        if (!tile) continue;
        const sampling = filterMode === 'point' ? gl.NEAREST : gl.LINEAR;
        if (tile.texture !== texture || sampling !== filter) {
          flush();
          texture = tile.texture;
          filter = sampling;
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        } else if (count === vertices.length) flush();
        const { u0, v0, u1, v1 } = tile;
        const right = topRight.x + bottomLeft.x - topLeft.x;
        const bottom = topRight.y + bottomLeft.y - topLeft.y;
        vertex(topLeft.x, topLeft.y, u0, v0, alpha);
        vertex(topRight.x, topRight.y, u1, v0, alpha);
        vertex(bottomLeft.x, bottomLeft.y, u0, v1, alpha);
        vertex(topRight.x, topRight.y, u1, v0, alpha);
        vertex(right, bottom, u1, v1, alpha);
        vertex(bottomLeft.x, bottomLeft.y, u0, v1, alpha);
      }
      flush();
    } finally {
      for (const attribute of attributes) gl.disableVertexAttribArray(attribute);
    }
  }

  dispose(): void {
    for (const texture of this.textures.keys()) this.gl.deleteTexture(texture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}
