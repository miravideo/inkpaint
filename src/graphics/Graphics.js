import Container from "../display/Container";
import RenderTexture from "../textures/RenderTexture";
import Texture from "../textures/Texture";
import GraphicsData from "./GraphicsData";
import Sprite from "../sprites/Sprite";
import {
  Matrix,
  Point,
  Rectangle,
  RoundedRectangle,
  Ellipse,
  Polygon,
  Circle
} from "../math";
import { hex2rgb, rgb2hex } from "../utils";
import { SHAPES, BLEND_MODES, PI_2 } from "../const";
import Bounds from "../display/Bounds";
import bezierCurveTo from "./utils/bezierCurveTo";
import CanvasRenderer from "../renderers/canvas/CanvasRenderer";

let canvasRenderer;
const tempMatrix = new Matrix();
const tempPoint = new Point();
const tempColor1 = new Float32Array(4);
const tempColor2 = new Float32Array(4);

export default class Graphics extends Container {
  constructor(nativeLines = false) {
    super();

    this.fillAlpha = 1;

    /**
     * The width (thickness) of any lines drawn.
     *
     * @member {number}
     * @default 0
     */
    this.lineWidth = 0;

    /**
     * If true the lines will be draw using LINES instead of TRIANGLE_STRIP
     *
     * @member {boolean}
     */
    this.nativeLines = nativeLines;

    /**
     * The color of any lines drawn.
     *
     * @member {string}
     * @default 0
     */
    this.lineColor = 0;

    /**
     * The alignment of any lines drawn (0.5 = middle, 1 = outter, 0 = inner).
     *
     * @member {number}
     * @default 0.5
     */
    this.lineAlignment = 0.5;

    /**
     * Graphics data
     *
     * @member {InkPaint.GraphicsData[]}
     * @private
     */
    this.graphicsData = [];

    /**
     * The tint applied to the graphic shape. This is a hex value. Apply a value of 0xFFFFFF to
     * reset the tint.
     *
     * @member {number}
     * @default 0xFFFFFF
     */
    this.tint = 0xffffff;

    /**
     * The previous tint applied to the graphic shape. Used to compare to the current tint and
     * check if theres change.
     *
     * @member {number}
     * @private
     * @default 0xFFFFFF
     */
    this._prevTint = 0xffffff;

    /**
     * The blend mode to be applied to the graphic shape. Apply a value of
     * `InkPaint.BLEND_MODES.NORMAL` to reset the blend mode.
     *
     * @member {number}
     * @default InkPaint.BLEND_MODES.NORMAL;
     * @see InkPaint.BLEND_MODES
     */
    this.blendMode = BLEND_MODES.NORMAL;

    /**
     * Current path
     *
     * @member {InkPaint.GraphicsData}
     * @private
     */
    this.currentPath = null;

    /**
     * Array containing some WebGL-related properties used by the WebGL renderer.
     *
     * @member {object<number, object>}
     * @private
     */
    // TODO - _webgl should use a prototype object, not a random undocumented object...
    this._webGL = {};

    /**
     * Whether this shape is being used as a mask.
     *
     * @member {boolean}
     */
    this.isMask = false;

    /**
     * The bounds' padding used for bounds calculation.
     *
     * @member {number}
     */
    this.boundsPadding = 0;

    /**
     * A cache of the local bounds to prevent recalculation.
     *
     * @member {InkPaint.Rectangle}
     * @private
     */
    this._localBounds = new Bounds();

    /**
     * Used to detect if the graphics object has changed. If this is set to true then the graphics
     * object will be recalculated.
     *
     * @member {boolean}
     * @private
     */
    this.dirty = 0;

    /**
     * Used to detect if we need to do a fast rect check using the id compare method
     * @type {Number}
     */
    this.fastRectDirty = -1;

    /**
     * Used to detect if we clear the graphics webGL data
     * @type {Number}
     */
    this.clearDirty = 0;

    /**
     * Used to detect if we we need to recalculate local bounds
     * @type {Number}
     */
    this.boundsDirty = -1;

    /**
     * Used to detect if the cached sprite object needs to be updated.
     *
     * @member {boolean}
     * @private
     */
    this.cachedSpriteDirty = false;

    this._spriteRect = null;
    this._fastRect = false;

    this._prevRectTint = null;
    this._prevRectFillColor = null;
  }

  clone() {
    const clone = new Graphics();

    clone.renderable = this.renderable;
    clone.fillAlpha = this.fillAlpha;
    clone.lineWidth = this.lineWidth;
    clone.lineColor = this.lineColor;
    clone.lineAlignment = this.lineAlignment;
    clone.tint = this.tint;
    clone.blendMode = this.blendMode;
    clone.isMask = this.isMask;
    clone.boundsPadding = this.boundsPadding;
    clone.dirty = 0;
    clone.cachedSpriteDirty = this.cachedSpriteDirty;

    // copy graphics data
    for (let i = 0; i < this.graphicsData.length; ++i) {
      clone.graphicsData.push(this.graphicsData[i].clone());
    }

    clone.currentPath = clone.graphicsData[clone.graphicsData.length - 1];

    clone.updateLocalBounds();

    return clone;
  }

  /**
   * Calculate length of quadratic curve
   * @see {@link http://www.malczak.linuxpl.com/blog/quadratic-bezier-curve-length/}
   * for the detailed explanation of math behind this.
   *
   * @private
   * @param {number} fromX - x-coordinate of curve start point
   * @param {number} fromY - y-coordinate of curve start point
   * @param {number} cpX - x-coordinate of curve control point
   * @param {number} cpY - y-coordinate of curve control point
   * @param {number} toX - x-coordinate of curve end point
   * @param {number} toY - y-coordinate of curve end point
   * @return {number} Length of quadratic curve
   */
  _quadraticCurveLength(fromX, fromY, cpX, cpY, toX, toY) {
    const ax = fromX - 2.0 * cpX + toX;
    const ay = fromY - 2.0 * cpY + toY;
    const bx = 2.0 * cpX - 2.0 * fromX;
    const by = 2.0 * cpY - 2.0 * fromY;
    const a = 4.0 * (ax * ax + ay * ay);
    const b = 4.0 * (ax * bx + ay * by);
    const c = bx * bx + by * by;

    const s = 2.0 * Math.sqrt(a + b + c);
    const a2 = Math.sqrt(a);
    const a32 = 2.0 * a * a2;
    const c2 = 2.0 * Math.sqrt(c);
    const ba = b / a2;

    return (
      (a32 * s +
        a2 * b * (s - c2) +
        (4.0 * c * a - b * b) * Math.log((2.0 * a2 + ba + s) / (ba + c2))) /
      (4.0 * a32)
    );
  }

  /**
   * Calculate length of bezier curve.
   * Analytical solution is impossible, since it involves an integral that does not integrate in general.
   * Therefore numerical solution is used.
   *
   * @private
   * @param {number} fromX - Starting point x
   * @param {number} fromY - Starting point y
   * @param {number} cpX - Control point x
   * @param {number} cpY - Control point y
   * @param {number} cpX2 - Second Control point x
   * @param {number} cpY2 - Second Control point y
   * @param {number} toX - Destination point x
   * @param {number} toY - Destination point y
   * @return {number} Length of bezier curve
   */
  _bezierCurveLength(fromX, fromY, cpX, cpY, cpX2, cpY2, toX, toY) {
    const n = 10;
    let result = 0.0;
    let t = 0.0;
    let t2 = 0.0;
    let t3 = 0.0;
    let nt = 0.0;
    let nt2 = 0.0;
    let nt3 = 0.0;
    let x = 0.0;
    let y = 0.0;
    let dx = 0.0;
    let dy = 0.0;
    let prevX = fromX;
    let prevY = fromY;

    for (let i = 1; i <= n; ++i) {
      t = i / n;
      t2 = t * t;
      t3 = t2 * t;
      nt = 1.0 - t;
      nt2 = nt * nt;
      nt3 = nt2 * nt;

      x = nt3 * fromX + 3.0 * nt2 * t * cpX + 3.0 * nt * t2 * cpX2 + t3 * toX;
      y = nt3 * fromY + 3.0 * nt2 * t * cpY + 3 * nt * t2 * cpY2 + t3 * toY;
      dx = prevX - x;
      dy = prevY - y;
      prevX = x;
      prevY = y;

      result += Math.sqrt(dx * dx + dy * dy);
    }

    return result;
  }

  /**
   * Calculate number of segments for the curve based on its length to ensure its smoothness.
   *
   * @private
   * @param {number} length - length of curve
   * @return {number} Number of segments
   */
  _segmentsCount(length) {
    let result = Math.ceil(length / Graphics.CURVES.maxLength);

    if (result < Graphics.CURVES.minSegments) {
      result = Graphics.CURVES.minSegments;
    } else if (result > Graphics.CURVES.maxSegments) {
      result = Graphics.CURVES.maxSegments;
    }

    return result;
  }

  /**
   * Specifies the line style used for subsequent calls to Graphics methods such as the lineTo()
   * method or the drawCircle() method.
   *
   * @param {number} [lineWidth=0] - width of the line to draw, will update the objects stored style
   * @param {number} [color=0] - color of the line to draw, will update the objects stored style
   * @param {number} [alpha=1] - alpha of the line to draw, will update the objects stored style
   * @param {number} [alignment=0.5] - alignment of the line to draw, (0 = inner, 0.5 = middle, 1 = outter)
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  lineStyle(lineWidth = 0, color = 0, alpha = 1, alignment = 0.5) {
    this.lineWidth = lineWidth;
    this.lineColor = color;
    this.lineAlpha = alpha;
    this.lineAlignment = alignment;

    if (this.currentPath) {
      if (this.currentPath.shape.points.length) {
        // halfway through a line? start a new one!
        const shape = new Polygon(this.currentPath.shape.points.slice(-2));

        shape.closed = false;

        this.drawShape(shape);
      } else {
        // otherwise its empty so lets just set the line properties
        this.currentPath.lineWidth = this.lineWidth;
        this.currentPath.lineColor = this.lineColor;
        this.currentPath.lineAlpha = this.lineAlpha;
        this.currentPath.lineAlignment = this.lineAlignment;
      }
    }

    return this;
  }

  /**
   * Moves the current drawing position to x, y.
   *
   * @param {number} x - the X coordinate to move to
   * @param {number} y - the Y coordinate to move to
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  moveTo(x, y) {
    const shape = new Polygon([x, y]);

    shape.closed = false;
    this.drawShape(shape);

    return this;
  }

  /**
   * Draws a line using the current line style from the current drawing position to (x, y);
   * The current drawing position is then set to (x, y).
   *
   * @param {number} x - the X coordinate to draw to
   * @param {number} y - the Y coordinate to draw to
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  lineTo(x, y) {
    const points = this.currentPath.shape.points;

    const fromX = points[points.length - 2];
    const fromY = points[points.length - 1];

    if (fromX !== x || fromY !== y) {
      points.push(x, y);
      this.dirty++;
    }

    return this;
  }

  /**
   * Calculate the points for a quadratic bezier curve and then draws it.
   * Based on: https://stackoverflow.com/questions/785097/how-do-i-implement-a-bezier-curve-in-c
   *
   * @param {number} cpX - Control point x
   * @param {number} cpY - Control point y
   * @param {number} toX - Destination point x
   * @param {number} toY - Destination point y
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  quadraticCurveTo(cpX, cpY, toX, toY) {
    if (this.currentPath) {
      if (this.currentPath.shape.points.length === 0) {
        this.currentPath.shape.points = [0, 0];
      }
    } else {
      this.moveTo(0, 0);
    }

    const points = this.currentPath.shape.points;
    let xa = 0;
    let ya = 0;

    if (points.length === 0) {
      this.moveTo(0, 0);
    }

    const fromX = points[points.length - 2];
    const fromY = points[points.length - 1];
    const n = Graphics.CURVES.adaptive
      ? this._segmentsCount(
          this._quadraticCurveLength(fromX, fromY, cpX, cpY, toX, toY)
        )
      : 20;

    for (let i = 1; i <= n; ++i) {
      const j = i / n;

      xa = fromX + (cpX - fromX) * j;
      ya = fromY + (cpY - fromY) * j;

      points.push(
        xa + (cpX + (toX - cpX) * j - xa) * j,
        ya + (cpY + (toY - cpY) * j - ya) * j
      );
    }

    this.dirty++;

    return this;
  }

  /**
   * Calculate the points for a bezier curve and then draws it.
   *
   * @param {number} cpX - Control point x
   * @param {number} cpY - Control point y
   * @param {number} cpX2 - Second Control point x
   * @param {number} cpY2 - Second Control point y
   * @param {number} toX - Destination point x
   * @param {number} toY - Destination point y
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  bezierCurveTo(cpX, cpY, cpX2, cpY2, toX, toY) {
    if (this.currentPath) {
      if (this.currentPath.shape.points.length === 0) {
        this.currentPath.shape.points = [0, 0];
      }
    } else {
      this.moveTo(0, 0);
    }

    const points = this.currentPath.shape.points;

    const fromX = points[points.length - 2];
    const fromY = points[points.length - 1];

    points.length -= 2;

    const n = Graphics.CURVES.adaptive
      ? this._segmentsCount(
          this._bezierCurveLength(fromX, fromY, cpX, cpY, cpX2, cpY2, toX, toY)
        )
      : 20;

    bezierCurveTo(fromX, fromY, cpX, cpY, cpX2, cpY2, toX, toY, n, points);

    this.dirty++;

    return this;
  }

  /**
   * The arcTo() method creates an arc/curve between two tangents on the canvas.
   *
   * "borrowed" from https://code.google.com/p/fxcanvas/ - thanks google!
   *
   * @param {number} x1 - The x-coordinate of the beginning of the arc
   * @param {number} y1 - The y-coordinate of the beginning of the arc
   * @param {number} x2 - The x-coordinate of the end of the arc
   * @param {number} y2 - The y-coordinate of the end of the arc
   * @param {number} radius - The radius of the arc
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  arcTo(x1, y1, x2, y2, radius) {
    if (this.currentPath) {
      if (this.currentPath.shape.points.length === 0) {
        this.currentPath.shape.points.push(x1, y1);
      }
    } else {
      this.moveTo(x1, y1);
    }

    const points = this.currentPath.shape.points;
    const fromX = points[points.length - 2];
    const fromY = points[points.length - 1];
    const a1 = fromY - y1;
    const b1 = fromX - x1;
    const a2 = y2 - y1;
    const b2 = x2 - x1;
    const mm = Math.abs(a1 * b2 - b1 * a2);

    if (mm < 1.0e-8 || radius === 0) {
      if (
        points[points.length - 2] !== x1 ||
        points[points.length - 1] !== y1
      ) {
        points.push(x1, y1);
      }
    } else {
      const dd = a1 * a1 + b1 * b1;
      const cc = a2 * a2 + b2 * b2;
      const tt = a1 * a2 + b1 * b2;
      const k1 = (radius * Math.sqrt(dd)) / mm;
      const k2 = (radius * Math.sqrt(cc)) / mm;
      const j1 = (k1 * tt) / dd;
      const j2 = (k2 * tt) / cc;
      const cx = k1 * b2 + k2 * b1;
      const cy = k1 * a2 + k2 * a1;
      const px = b1 * (k2 + j1);
      const py = a1 * (k2 + j1);
      const qx = b2 * (k1 + j2);
      const qy = a2 * (k1 + j2);
      const startAngle = Math.atan2(py - cy, px - cx);
      const endAngle = Math.atan2(qy - cy, qx - cx);

      this.arc(
        cx + x1,
        cy + y1,
        radius,
        startAngle,
        endAngle,
        b1 * a2 > b2 * a1
      );
    }

    this.dirty++;

    return this;
  }

  /**
   * The arc method creates an arc/curve (used to create circles, or parts of circles).
   *
   * @param {number} cx - The x-coordinate of the center of the circle
   * @param {number} cy - The y-coordinate of the center of the circle
   * @param {number} radius - The radius of the circle
   * @param {number} startAngle - The starting angle, in radians (0 is at the 3 o'clock position
   *  of the arc's circle)
   * @param {number} endAngle - The ending angle, in radians
   * @param {boolean} [anticlockwise=false] - Specifies whether the drawing should be
   *  counter-clockwise or clockwise. False is default, and indicates clockwise, while true
   *  indicates counter-clockwise.
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  arc(cx, cy, radius, startAngle, endAngle, anticlockwise = false) {
    if (startAngle === endAngle) {
      return this;
    }

    if (!anticlockwise && endAngle <= startAngle) {
      endAngle += PI_2;
    } else if (anticlockwise && startAngle <= endAngle) {
      startAngle += PI_2;
    }

    const sweep = endAngle - startAngle;
    const segs = Graphics.CURVES.adaptive
      ? this._segmentsCount(Math.abs(sweep) * radius)
      : Math.ceil(Math.abs(sweep) / PI_2) * 40;

    if (sweep === 0) {
      return this;
    }

    const startX = cx + Math.cos(startAngle) * radius;
    const startY = cy + Math.sin(startAngle) * radius;

    // If the currentPath exists, take its points. Otherwise call `moveTo` to start a path.
    let points = this.currentPath ? this.currentPath.shape.points : null;

    if (points) {
      // We check how far our start is from the last existing point
      const xDiff = Math.abs(points[points.length - 2] - startX);
      const yDiff = Math.abs(points[points.length - 1] - startY);

      if (xDiff < 0.001 && yDiff < 0.001) {
        // If the point is very close, we don't add it, since this would lead to artifacts
        // during tesselation due to floating point imprecision.
      } else {
        points.push(startX, startY);
      }
    } else {
      this.moveTo(startX, startY);
      points = this.currentPath.shape.points;
    }

    const theta = sweep / (segs * 2);
    const theta2 = theta * 2;

    const cTheta = Math.cos(theta);
    const sTheta = Math.sin(theta);

    const segMinus = segs - 1;

    const remainder = (segMinus % 1) / segMinus;

    for (let i = 0; i <= segMinus; ++i) {
      const real = i + remainder * i;

      const angle = theta + startAngle + theta2 * real;

      const c = Math.cos(angle);
      const s = -Math.sin(angle);

      points.push(
        (cTheta * c + sTheta * s) * radius + cx,
        (cTheta * -s + sTheta * c) * radius + cy
      );
    }

    this.dirty++;

    return this;
  }

  /**
   * Specifies a simple one-color fill that subsequent calls to other Graphics methods
   * (such as lineTo() or drawCircle()) use when drawing.
   *
   * @param {number} [color=0] - the color of the fill
   * @param {number} [alpha=1] - the alpha of the fill
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  beginFill(color = 0, alpha = 1) {
    this.filling = true;
    this.fillColor = color;
    this.fillAlpha = alpha;

    if (this.currentPath) {
      if (this.currentPath.shape.points.length <= 2) {
        this.currentPath.fill = this.filling;
        this.currentPath.fillColor = this.fillColor;
        this.currentPath.fillAlpha = this.fillAlpha;
      }
    }

    return this;
  }

  /**
   * Applies a fill to the lines and shapes that were added since the last call to the beginFill() method.
   *
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  endFill() {
    this.filling = false;
    this.fillColor = null;
    this.fillAlpha = 1;

    return this;
  }

  /**
   *
   * @param {number} x - The X coord of the top-left of the rectangle
   * @param {number} y - The Y coord of the top-left of the rectangle
   * @param {number} width - The width of the rectangle
   * @param {number} height - The height of the rectangle
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  drawRect(x, y, width, height) {
    this.drawShape(new Rectangle(x, y, width, height));

    return this;
  }

  /**
   *
   * @param {number} x - The X coord of the top-left of the rectangle
   * @param {number} y - The Y coord of the top-left of the rectangle
   * @param {number} width - The width of the rectangle
   * @param {number} height - The height of the rectangle
   * @param {number} radius - Radius of the rectangle corners
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  drawRoundedRect(x, y, width, height, radius) {
    this.drawShape(new RoundedRectangle(x, y, width, height, radius));

    return this;
  }

  /**
   * Draws a circle.
   *
   * @param {number} x - The X coordinate of the center of the circle
   * @param {number} y - The Y coordinate of the center of the circle
   * @param {number} radius - The radius of the circle
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  drawCircle(x, y, radius) {
    this.drawShape(new Circle(x, y, radius));

    return this;
  }

  /**
   * Draws an ellipse.
   *
   * @param {number} x - The X coordinate of the center of the ellipse
   * @param {number} y - The Y coordinate of the center of the ellipse
   * @param {number} width - The half width of the ellipse
   * @param {number} height - The half height of the ellipse
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  drawEllipse(x, y, width, height) {
    this.drawShape(new Ellipse(x, y, width, height));

    return this;
  }

  /**
   * Draws a polygon using the given path.
   *
   * @param {number[]|InkPaint.Point[]|InkPaint.Polygon} path - The path data used to construct the polygon.
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  drawPolygon(path) {
    // prevents an argument assignment deopt
    // see section 3.1: https://github.com/petkaantonov/bluebird/wiki/Optimization-killers#3-managing-arguments
    let points = path;

    let closed = true;

    if (points instanceof Polygon) {
      closed = points.closed;
      points = points.points;
    }

    if (!Array.isArray(points)) {
      // prevents an argument leak deopt
      // see section 3.2: https://github.com/petkaantonov/bluebird/wiki/Optimization-killers#3-managing-arguments
      points = new Array(arguments.length);

      for (let i = 0; i < points.length; ++i) {
        points[i] = arguments[i]; // eslint-disable-line prefer-rest-params
      }
    }

    const shape = new Polygon(points);

    shape.closed = closed;

    this.drawShape(shape);

    return this;
  }

  /**
   * Draw a star shape with an abitrary number of points.
   *
   * @param {number} x - Center X position of the star
   * @param {number} y - Center Y position of the star
   * @param {number} points - The number of points of the star, must be > 1
   * @param {number} radius - The outer radius of the star
   * @param {number} [innerRadius] - The inner radius between points, default half `radius`
   * @param {number} [rotation=0] - The rotation of the star in radians, where 0 is vertical
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  drawStar(x, y, points, radius, innerRadius, rotation = 0) {
    innerRadius = innerRadius || radius / 2;

    const startAngle = (-1 * Math.PI) / 2 + rotation;
    const len = points * 2;
    const delta = PI_2 / len;
    const polygon = [];

    for (let i = 0; i < len; i++) {
      const r = i % 2 ? innerRadius : radius;
      const angle = i * delta + startAngle;

      polygon.push(x + r * Math.cos(angle), y + r * Math.sin(angle));
    }

    return this.drawPolygon(polygon);
  }

  /**
   * Clears the graphics that were drawn to this Graphics object, and resets fill and line style settings.
   *
   * @return {InkPaint.Graphics} This Graphics object. Good for chaining method calls
   */
  clear() {
    if (this.lineWidth || this.filling || this.graphicsData.length > 0) {
      this.lineWidth = 0;
      this.lineAlignment = 0.5;

      this.filling = false;

      this.boundsDirty = -1;
      this.canvasTintDirty = -1;
      this.dirty++;
      this.clearDirty++;
      this.graphicsData.length = 0;
    }

    this.currentPath = null;
    this._spriteRect = null;

    return this;
  }

  /**
   * True if graphics consists of one rectangle, and thus, can be drawn like a Sprite and
   * masked with gl.scissor.
   *
   * @returns {boolean} True if only 1 rect.
   */
  isFastRect() {
    return (
      this.graphicsData.length === 1 &&
      this.graphicsData[0].shape.type === SHAPES.RECT &&
      !this.graphicsData[0].lineWidth
    );
  }

  /**
   * Renders the object using the WebGL renderer
   *
   * @private
   * @param {InkPaint.WebGLRenderer} renderer - The renderer
   */
  _renderWebGL(renderer) {
    // if the sprite is not visible or the alpha is 0 then no need to render this element
    if (this.dirty !== this.fastRectDirty) {
      this.fastRectDirty = this.dirty;
      this._fastRect = this.isFastRect();
    }

    // TODO this check can be moved to dirty?
    if (this._fastRect) {
      this._renderSpriteRect(renderer);
    } else {
      renderer.setObjectRenderer(renderer.plugins.graphics);
      renderer.plugins.graphics.render(this);
    }
  }

  /**
   * Renders a sprite rectangle.
   *
   * @private
   * @param {InkPaint.WebGLRenderer} renderer - The renderer
   */
  _renderSpriteRect(renderer) {
    const rect = this.graphicsData[0].shape;

    if (!this._spriteRect) {
      this._spriteRect = new Sprite(new Texture(Texture.EMPTY));
    }

    const sprite = this._spriteRect;
    const fillColor = this.graphicsData[0].fillColor;

    if (this.tint === 0xffffff) {
      sprite.tint = fillColor;
    } else if (
      this.tint !== this._prevRectTint ||
      fillColor !== this._prevRectFillColor
    ) {
      const t1 = tempColor1;
      const t2 = tempColor2;

      hex2rgb(fillColor, t1);
      hex2rgb(this.tint, t2);

      t1[0] *= t2[0];
      t1[1] *= t2[1];
      t1[2] *= t2[2];

      sprite.tint = rgb2hex(t1);

      this._prevRectTint = this.tint;
      this._prevRectFillColor = fillColor;
    }

    sprite.alpha = this.graphicsData[0].fillAlpha;
    sprite.worldAlpha = this.worldAlpha * sprite.alpha;
    sprite.blendMode = this.blendMode;

    sprite._texture._frame.width = rect.width;
    sprite._texture._frame.height = rect.height;

    sprite.transform.worldTransform = this.transform.worldTransform;

    sprite.anchor.set(-rect.x / rect.width, -rect.y / rect.height);
    sprite._onAnchorUpdate();

    sprite._renderWebGL(renderer);
  }

  _renderCanvas(renderer) {
    if (this.isMask === true) {
      return;
    }

    renderer.plugins.graphics.render(this);
  }

  /**
   * Retrieves the bounds of the graphic shape as a rectangle object
   *
   * @private
   */
  _calculateBounds() {
    if (this.boundsDirty !== this.dirty) {
      this.boundsDirty = this.dirty;
      this.updateLocalBounds();

      this.cachedSpriteDirty = true;
    }

    const lb = this._localBounds;

    this._bounds.addFrame(this.transform, lb.minX, lb.minY, lb.maxX, lb.maxY);
  }

  /**
   * Tests if a point is inside this graphics object
   *
   * @param {InkPaint.Point} point - the point to test
   * @return {boolean} the result of the test
   */
  containsPoint(point) {
    this.worldTransform.applyInverse(point, tempPoint);

    const graphicsData = this.graphicsData;

    for (let i = 0; i < graphicsData.length; ++i) {
      const data = graphicsData[i];

      if (!data.fill) {
        continue;
      }

      // only deal with fills..
      if (data.shape) {
        if (data.shape.contains(tempPoint.x, tempPoint.y)) {
          let hitHole = false;

          if (data.holes) {
            for (let i = 0; i < data.holes.length; i++) {
              const hole = data.holes[i];

              if (hole.contains(tempPoint.x, tempPoint.y)) {
                hitHole = true;
                break;
              }
            }
          }

          if (!hitHole) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Update the bounds of the object
   *
   */
  updateLocalBounds() {
    let minX = Infinity;
    let maxX = -Infinity;

    let minY = Infinity;
    let maxY = -Infinity;

    if (this.graphicsData.length) {
      let shape = 0;
      let x = 0;
      let y = 0;
      let w = 0;
      let h = 0;

      for (let i = 0; i < this.graphicsData.length; i++) {
        const data = this.graphicsData[i];
        const type = data.type;
        const lineWidth = data.lineWidth;
        const lineAlignment = data.lineAlignment;

        const lineOffset = lineWidth * lineAlignment;

        shape = data.shape;

        if (type === SHAPES.RECT || type === SHAPES.RREC) {
          x = shape.x - lineOffset;
          y = shape.y - lineOffset;
          w = shape.width + lineOffset * 2;
          h = shape.height + lineOffset * 2;

          minX = x < minX ? x : minX;
          maxX = x + w > maxX ? x + w : maxX;

          minY = y < minY ? y : minY;
          maxY = y + h > maxY ? y + h : maxY;
        } else if (type === SHAPES.CIRC) {
          x = shape.x;
          y = shape.y;
          w = shape.radius + lineOffset;
          h = shape.radius + lineOffset;

          minX = x - w < minX ? x - w : minX;
          maxX = x + w > maxX ? x + w : maxX;

          minY = y - h < minY ? y - h : minY;
          maxY = y + h > maxY ? y + h : maxY;
        } else if (type === SHAPES.ELIP) {
          x = shape.x;
          y = shape.y;
          w = shape.width + lineOffset;
          h = shape.height + lineOffset;

          minX = x - w < minX ? x - w : minX;
          maxX = x + w > maxX ? x + w : maxX;

          minY = y - h < minY ? y - h : minY;
          maxY = y + h > maxY ? y + h : maxY;
        } else {
          // POLY
          const points = shape.points;
          let x2 = 0;
          let y2 = 0;
          let dx = 0;
          let dy = 0;
          let rw = 0;
          let rh = 0;
          let cx = 0;
          let cy = 0;

          for (let j = 0; j + 2 < points.length; j += 2) {
            x = points[j];
            y = points[j + 1];
            x2 = points[j + 2];
            y2 = points[j + 3];
            dx = Math.abs(x2 - x);
            dy = Math.abs(y2 - y);
            h = lineOffset * 2;
            w = Math.sqrt(dx * dx + dy * dy);

            if (w < 1e-9) {
              continue;
            }

            rw = ((h / w) * dy + dx) / 2;
            rh = ((h / w) * dx + dy) / 2;
            cx = (x2 + x) / 2;
            cy = (y2 + y) / 2;

            minX = cx - rw < minX ? cx - rw : minX;
            maxX = cx + rw > maxX ? cx + rw : maxX;

            minY = cy - rh < minY ? cy - rh : minY;
            maxY = cy + rh > maxY ? cy + rh : maxY;
          }
        }
      }
    } else {
      minX = 0;
      maxX = 0;
      minY = 0;
      maxY = 0;
    }

    const padding = this.boundsPadding;

    this._localBounds.minX = minX - padding;
    this._localBounds.maxX = maxX + padding;

    this._localBounds.minY = minY - padding;
    this._localBounds.maxY = maxY + padding;
  }

  /**
   * Draws the given shape to this Graphics object. Can be any of Circle, Rectangle, Ellipse, Line or Polygon.
   *
   * @param {InkPaint.Circle|InkPaint.Ellipse|InkPaint.Polygon|InkPaint.Rectangle|InkPaint.RoundedRectangle} shape - The shape object to draw.
   * @return {InkPaint.GraphicsData} The generated GraphicsData object.
   */
  drawShape(shape) {
    if (this.currentPath) {
      // check current path!
      if (this.currentPath.shape.points.length <= 2) {
        this.graphicsData.pop();
      }
    }

    this.currentPath = null;

    const data = new GraphicsData(
      this.lineWidth,
      this.lineColor,
      this.lineAlpha,
      this.fillColor,
      this.fillAlpha,
      this.filling,
      this.nativeLines,
      shape,
      this.lineAlignment
    );

    this.graphicsData.push(data);

    if (data.type === SHAPES.POLY) {
      data.shape.closed = data.shape.closed;
      this.currentPath = data;
    }

    this.dirty++;

    return data;
  }

  generateTexture(renderer, scaleMode, resolution = 1) {
    const bounds = this.getLocalBounds();

    const texture = RenderTexture.create(
      bounds.width,
      bounds.height,
      scaleMode,
      resolution
    );

    this.transform.updateLocalTransform();
    this.transform.localTransform.copy(tempMatrix);

    tempMatrix.invert();

    tempMatrix.tx -= bounds.x;
    tempMatrix.ty -= bounds.y;

    renderer.render(this, texture, true, tempMatrix);
    return texture;
  }

  generateCanvasTexture(scaleMode, resolution = 1) {
    const bounds = this.getLocalBounds();

    const canvasBuffer = RenderTexture.create(
      bounds.width,
      bounds.height,
      scaleMode,
      resolution
    );

    if (!canvasRenderer) {
      canvasRenderer = new CanvasRenderer();
    }

    this.transform.updateLocalTransform();
    this.transform.localTransform.copy(tempMatrix);

    tempMatrix.invert();

    tempMatrix.tx -= bounds.x;
    tempMatrix.ty -= bounds.y;

    canvasRenderer.render(this, canvasBuffer, true, tempMatrix);

    const texture = Texture.fromCanvas(
      canvasBuffer.baseTexture._canvasRenderTarget.canvas,
      scaleMode,
      "graphics"
    );

    texture.baseTexture.resolution = resolution;
    texture.baseTexture.update();

    return texture;
  }

  /**
   * Closes the current path.
   *
   * @return {InkPaint.Graphics} Returns itself.
   */
  closePath() {
    // ok so close path assumes next one is a hole!
    const currentPath = this.currentPath;

    if (currentPath && currentPath.shape) {
      currentPath.shape.close();
    }

    return this;
  }

  /**
   * Adds a hole in the current path.
   *
   * @return {InkPaint.Graphics} Returns itself.
   */
  addHole() {
    // this is a hole!
    const hole = this.graphicsData.pop();

    this.currentPath = this.graphicsData[this.graphicsData.length - 1];

    this.currentPath.addHole(hole.shape);
    this.currentPath = null;

    return this;
  }

  /**
   * Destroys the Graphics object.
   *
   * @param {object|boolean} [options] - Options parameter. A boolean will act as if all
   *  options have been set to that value
   * @param {boolean} [options.children=false] - if set to true, all the children will have
   *  their destroy method called as well. 'options' will be passed on to those calls.
   * @param {boolean} [options.texture=false] - Only used for child Sprites if options.children is set to true
   *  Should it destroy the texture of the child sprite
   * @param {boolean} [options.baseTexture=false] - Only used for child Sprites if options.children is set to true
   *  Should it destroy the base texture of the child sprite
   */
  destroy(options) {
    super.destroy(options);

    // destroy each of the GraphicsData objects
    for (let i = 0; i < this.graphicsData.length; ++i) {
      this.graphicsData[i].destroy();
    }

    // for each webgl data entry, destroy the WebGLGraphicsData
    for (const id in this._webGL) {
      for (let j = 0; j < this._webGL[id].data.length; ++j) {
        this._webGL[id].data[j].destroy();
      }
    }

    if (this._spriteRect) {
      this._spriteRect.destroy();
    }

    this.graphicsData = null;

    this.currentPath = null;
    this._webGL = null;
    this._localBounds = null;
  }
}

Graphics._SPRITE_TEXTURE = null;

Graphics.CURVES = {
  adaptive: false,
  maxLength: 10,
  minSegments: 8,
  maxSegments: 2048
};
