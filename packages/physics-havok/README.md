## Installation

To install, use:

```sh
npm install @galacean/engine-physics-havok
```

This will allow you to import the Havok physics backend using:

```javascript
import * as PHYSICS_HAVOK from "@galacean/engine-physics-havok";
```

or individual classes using:

```javascript
import { HavokPhysics } from "@galacean/engine-physics-havok";
```

## Usage

```typescript
// Create engine by passing in the HTMLCanvasElement id and adjust canvas size
const engine = await WebGLEngine.create({ canvas: "canvas-id" });

// Initialize physics manager with HavokPhysics.
engine.physicsManager.initialize(HavokPhysics);

......

// Run engine.
engine.run();
```
