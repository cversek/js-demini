/**
 * Class Hierarchy — Inheritance, Private Fields, Static Methods
 *
 * Tests: class declarations, extends, super(), private fields (#),
 * getters/setters, static methods, instanceof.
 */

export class Shape {
  #name;
  #color;

  constructor(name, color = "black") {
    this.#name = name;
    this.#color = color;
  }

  get name() {
    return this.#name;
  }

  get color() {
    return this.#color;
  }

  set color(value) {
    this.#color = value;
  }

  area() {
    throw new Error(`${this.#name}.area() not implemented`);
  }

  describe() {
    return `${this.#color} ${this.#name} with area ${this.area().toFixed(4)}`;
  }

  static isShape(obj) {
    return obj instanceof Shape;
  }
}

export class Circle extends Shape {
  #radius;

  constructor(radius, color) {
    super("circle", color);
    this.#radius = radius;
  }

  get radius() {
    return this.#radius;
  }

  area() {
    return Math.PI * this.#radius ** 2;
  }

  circumference() {
    return 2 * Math.PI * this.#radius;
  }
}

export class Rectangle extends Shape {
  #width;
  #height;

  constructor(width, height, color) {
    super("rectangle", color);
    this.#width = width;
    this.#height = height;
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  area() {
    return this.#width * this.#height;
  }

  perimeter() {
    return 2 * (this.#width + this.#height);
  }

  isSquare() {
    return this.#width === this.#height;
  }
}

/**
 * Factory function — tests non-class object creation patterns.
 */
export function createShapeReport(shapes) {
  const totalArea = shapes.reduce((sum, s) => sum + s.area(), 0);
  const byType = {};
  for (const s of shapes) {
    const type = s.name;
    byType[type] = (byType[type] || 0) + 1;
  }
  return { totalArea, count: shapes.length, byType };
}
