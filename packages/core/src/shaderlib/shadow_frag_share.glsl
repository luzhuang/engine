#ifdef O3_SHADOW_MAP_COUNT

uniform float u_shadowBias[O3_SHADOW_MAP_COUNT];
uniform float u_shadowIntensity[O3_SHADOW_MAP_COUNT];
uniform float u_shadowRadius[O3_SHADOW_MAP_COUNT];
uniform vec2 u_shadowMapSize[O3_SHADOW_MAP_COUNT];
uniform sampler2D u_shadowMaps[O3_SHADOW_MAP_COUNT];

varying vec4 v_PositionFromLight[O3_SHADOW_MAP_COUNT];

const vec4 bitShift = vec4(1.0, 1.0/256.0, 1.0/(256.0*256.0), 1.0/(256.0*256.0*256.0));

/**
* Unpack depth value.
*/
float unpack(const in vec4 rgbaDepth) {
  return dot(rgbaDepth, bitShift);
}

/**
* Degree of shadow.
*/
float getVisibility(vec4 positionFromLight, const in sampler2D shadowMap, vec2 mapSize, float intensity, float bias, float radius) {

    vec3 shadowCoord = (positionFromLight.xyz/positionFromLight.w)/2.0 + 0.5;
    float filterX = step(0.0, shadowCoord.x) * (1.0 - step(1.0, shadowCoord.x));
    float filterY = step(0.0, shadowCoord.y) * (1.0 - step(1.0, shadowCoord.y));

    shadowCoord.z -= bias;
    vec2 texelSize = vec2( 1.0 ) / mapSize;

    float visibility = 0.0;
    for (float y = -1.0 ; y <=1.0 ; y+=1.0) {
      for (float x = -1.0 ; x <=1.0 ; x+=1.0) {
        vec2 uv = shadowCoord.xy + texelSize * vec2(x, y) * radius;
        vec4 rgbaDepth = texture2D(shadowMap, uv);
        float depth = unpack(rgbaDepth);
        visibility += step(depth, shadowCoord.z) * intensity;
      }
    }

    visibility *= ( 1.0 / 9.0 );
    return visibility * filterX * filterY;

}

#endif