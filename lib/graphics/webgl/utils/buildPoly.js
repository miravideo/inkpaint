"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = buildPoly;

var _buildLine = _interopRequireDefault(require("./buildLine"));

var _utils = require("../../../utils");

var _earcut = _interopRequireDefault(require("earcut"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function buildPoly(graphicsData, webGLData, webGLDataNativeLines) {
  graphicsData.points = graphicsData.shape.points.slice();
  var points = graphicsData.points;

  if (graphicsData.fill && points.length >= 6) {
    var holeArray = []; // Process holes..

    var holes = graphicsData.holes;

    for (var i = 0; i < holes.length; i++) {
      var hole = holes[i];
      holeArray.push(points.length / 2);
      points = points.concat(hole.points);
    } // get first and last point.. figure out the middle!


    var verts = webGLData.points;
    var indices = webGLData.indices;
    var length = points.length / 2; // sort color

    var color = (0, _utils.hex2rgb)(graphicsData.fillColor);
    var alpha = graphicsData.fillAlpha;
    var r = color[0] * alpha;
    var g = color[1] * alpha;
    var b = color[2] * alpha;
    var triangles = (0, _earcut.default)(points, holeArray, 2);

    if (!triangles) {
      return;
    }

    var vertPos = verts.length / 6;

    for (var _i = 0; _i < triangles.length; _i += 3) {
      indices.push(triangles[_i] + vertPos);
      indices.push(triangles[_i] + vertPos);
      indices.push(triangles[_i + 1] + vertPos);
      indices.push(triangles[_i + 2] + vertPos);
      indices.push(triangles[_i + 2] + vertPos);
    }

    for (var _i2 = 0; _i2 < length; _i2++) {
      verts.push(points[_i2 * 2], points[_i2 * 2 + 1], r, g, b, alpha);
    }
  }

  if (graphicsData.lineWidth > 0) {
    (0, _buildLine.default)(graphicsData, webGLData, webGLDataNativeLines);
  }
}
//# sourceMappingURL=buildPoly.js.map