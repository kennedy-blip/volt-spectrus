import { Injectable } from '@angular/core';
import { GLSL_PLASMA_SOURCE } from '../../generated/embedded-sources';
import type { ThemeKey } from '../models';

export interface PlasmaParams {
  thd: number;
  fluxUt: number;
  freqHz: number;
  energy: number;
  theme: ThemeKey;
  lowGpu: boolean;
}

const THEME_INDEX: Record<ThemeKey, number> = {
  obsidian: 0,
  daylight: 1,
  amber: 2,
  eco: 3,
};

const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * WebGL2 renderer for the GLSL plasma / electromagnetic flux-line underlay.
 * Falls back gracefully (returns false) when WebGL2 is unavailable, letting
 * the component paint a CSS gradient instead.
 */
@Injectable({ providedIn: 'root' })
export class PlasmaRendererService {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private rafId = 0;
  private startTime = 0;
  private lowGpu = false;
  private canvas: HTMLCanvasElement | null = null;

  /** Compile the embedded GLSL shader and allocate the full-screen triangle. */
  init(canvas: HTMLCanvasElement): boolean {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return false;
    this.gl = gl;

    const program = this.buildProgram(gl);
    if (!program) return false;
    this.program = program;
    gl.useProgram(program);

    // Full-screen triangle.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    for (const name of [
      'u_resolution',
      'u_time',
      'u_thd',
      'u_flux',
      'u_freq',
      'u_energy',
      'u_theme',
      'u_lowGpu',
    ]) {
      this.uniforms.set(name, gl.getUniformLocation(program, name));
    }

    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    return true;
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.stop();
  };

  private buildProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
    const compile = (type: number, src: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[plasma] shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, GLSL_PLASMA_SOURCE);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[plasma] program link failed:', gl.getProgramInfoLog(program));
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  setLowGpu(lowGpu: boolean): void {
    this.lowGpu = lowGpu;
  }

  /** Start the rAF loop; `getParams` is polled each frame. */
  start(getParams: () => PlasmaParams): void {
    if (!this.gl || !this.program || this.rafId) return;
    this.startTime = performance.now();
    const loop = () => {
      this.draw(getParams(), (performance.now() - this.startTime) / 1000);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private resize(): void {
    if (!this.gl || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = Math.max(w, 1);
      this.canvas.height = Math.max(h, 1);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private draw(p: PlasmaParams, t: number): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    this.resize();

    gl.uniform2f(this.uniforms.get('u_resolution') ?? null, this.canvas!.width, this.canvas!.height);
    gl.uniform1f(this.uniforms.get('u_time') ?? null, t);
    gl.uniform1f(this.uniforms.get('u_thd') ?? null, Math.min(p.thd / 40, 1));
    gl.uniform1f(this.uniforms.get('u_flux') ?? null, Math.min(p.fluxUt / 100, 1));
    gl.uniform1f(this.uniforms.get('u_freq') ?? null, Math.min(Math.max((p.freqHz - 45) / 25, 0), 1));
    gl.uniform1f(this.uniforms.get('u_energy') ?? null, p.energy);
    gl.uniform1i(this.uniforms.get('u_theme') ?? null, THEME_INDEX[p.theme]);
    gl.uniform1i(this.uniforms.get('u_lowGpu') ?? null, p.lowGpu ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
