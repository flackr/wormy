function Map(w, h) {
  this.data = [];
  for (var i = 0; i < h; i++) {
    this.data.push([]);
    for (var j = 0; j < w; j++) {
      this.data[i].push((i == 0 || j == 0 | i == h - 1 | j == w - 1 ? 1 : 0));
    }
  }
}

Map.prototype = {
  drawLine: function(x, y, dx, dy, l, c) {
    if (c === undefined) c = 1;
    for (var i = 0; i < l; i++) {
      this.data[y][x] = c;
      x += dx;
      y += dy;
    }
  }
};

exports.getLevel = function(level) {
  level = level % 8;
  var m = new Map(80, 50);
  if (level == 1) {
    // |  |
    m.drawLine(27, 10, 0, 1, 30);
    m.drawLine(54, 10, 0, 1, 30);
  } else if (level == 2) {
    //  --
    // |  |
    //  --
    m.drawLine(13, 10, 1, 0, 54);
    m.drawLine(13, 40, 1, 0, 54);
    m.drawLine(10, 13, 0, 1, 24);
    m.drawLine(69, 13, 0, 1, 24);
  } else if (level == 3) {
    //  \ \
    m.drawLine(15, 10, 1, 1, 30);
    m.drawLine(35, 10, 1, 1, 30);
  } else if (level == 4) {
    // | --
    //-- |
    m.drawLine(22, 1, 0, 1, 24);
    m.drawLine(1, 34, 1, 0, 44);
    m.drawLine(79 - 22, 49 - 1, 0, -1, 24);
    m.drawLine(79 - 1, 49 - 34, -1, 0, 44);

    m.drawLine(0, 1, 0, 1, 14, 0);
    m.drawLine(79, 1, 0, 1, 14, 0);

    m.drawLine(0, 35, 0, 1, 14, 0);
    m.drawLine(79, 35, 0, 1, 14, 0);
  } else if (level == 5) {
    // :
    m.drawLine(39, 1, 0, 2, 25);
  } else if (level == 6) {
    m.drawLine(0, 20, 0, 1, 11, 0);
    m.drawLine(79, 20, 0, 1, 11, 0);
    m.drawLine(20, 15, 1, 0, 30);
    m.drawLine(20, 15, 0, 1, 21);
    m.drawLine(20, 35, 1, 0, 30);
    m.drawLine(50, 15, 0, 1, 5);
    m.drawLine(50, 31, 0, 1, 5);
    m.drawLine(50, 19, 1, 0, 30);
    m.drawLine(50, 31, 1, 0, 30);

    m.drawLine(51, 0, 1, 0, 28, 0);
    m.drawLine(51, 49, 1, 0, 28, 0);
  } else if (level == 7) {
    m.drawLine(0, 1, 0, 2, 11, 0);
    m.drawLine(79, 1, 0, 2, 11, 0);
    m.drawLine(0, 38, 0, 1, 11, 0);
    m.drawLine(79, 38, 0, 1, 11, 0);
    m.drawLine(16, 0, 1, 0, 14, 0);
    m.drawLine(16, 49, 1, 0, 14, 0);

    m.drawLine(15, 11, 0, 1, 38);
    m.drawLine(15, 11, 1, 0, 27);
    m.drawLine(53, 1, 0, 1, 25);
    m.drawLine(30, 25, 1, 0, 24);
    m.drawLine(30, 37, 1, 0, 49);
  }
  return m.data;
};
