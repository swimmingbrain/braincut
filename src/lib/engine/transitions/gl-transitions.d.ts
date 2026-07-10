declare module 'gl-transitions' {
  export type GlTransitionParamType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'ivec2' | 'sampler2D';

  export interface GlTransition {
    name: string;
    author: string;
    license: string;
    glsl: string;
    defaultParams: Record<string, number | boolean | number[]>;
    paramsTypes: Record<string, GlTransitionParamType>;
    createdAt: string;
    updatedAt: string;
  }

  const transitions: GlTransition[];
  export default transitions;
}
