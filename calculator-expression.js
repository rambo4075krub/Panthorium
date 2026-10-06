(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PanthoriumCalculatorMath = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function evaluate(input) {
    const source = String(input == null ? "" : input)
      .replace(/×/g, "*")
      .replace(/÷/g, "/")
      .replace(/\s+/g, "");
    if (!source || source.length > 256) throw new Error("invalid_expression");

    const tokens = source.match(/\d+(?:\.\d*)?|\.\d+|[()+\-*/]/g) || [];
    if (tokens.join("") !== source) throw new Error("invalid_expression");

    let index = 0;
    function primary() {
      const token = tokens[index];
      if (token === "+" || token === "-") {
        index += 1;
        const value = primary();
        return token === "-" ? -value : value;
      }
      if (token === "(") {
        index += 1;
        const value = expression();
        if (tokens[index] !== ")") throw new Error("invalid_expression");
        index += 1;
        return value;
      }
      if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error("invalid_expression");
      index += 1;
      return Number(token);
    }

    function term() {
      let value = primary();
      while (tokens[index] === "*" || tokens[index] === "/") {
        const operator = tokens[index++];
        const right = primary();
        if (operator === "/" && right === 0) throw new Error("division_by_zero");
        value = operator === "*" ? value * right : value / right;
      }
      return value;
    }

    function expression() {
      let value = term();
      while (tokens[index] === "+" || tokens[index] === "-") {
        const operator = tokens[index++];
        const right = term();
        value = operator === "+" ? value + right : value - right;
      }
      return value;
    }

    const result = expression();
    if (index !== tokens.length) throw new Error("invalid_expression");
    if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) throw new Error("calculation_out_of_range");
    const rounded = Number(result.toPrecision(12));
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  return { evaluate };
});
