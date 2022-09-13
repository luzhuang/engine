import { RenderData2D } from "../2d/data/RenderData2D";
import { Material } from "../material/Material";
import { Renderer } from "../Renderer";
import { Texture2D } from "../texture";
import { RenderElement } from "./RenderElement";

export class SpriteElement extends RenderElement {
  renderData: RenderData2D;
  texture: Texture2D;
  dataIndex: number;

<<<<<<< HEAD
=======
  constructor() {
    super();
    this.multiRenderData = false;
  }

>>>>>>> 281e9b81a746a87eec1ac03ff1aaae28e3c98e7b
  setValue(
    component: Renderer,
    renderDate: RenderData2D,
    material: Material,
    texture: Texture2D,
    dataIndex: number = 0
  ): void {
    this.component = component;
    this.renderData = renderDate;
    this.material = material;
    this.texture = texture;
    this.dataIndex = dataIndex;
  }
}
