import { ToolError } from "./tools";
/**
 * A safe arithmetic evaluator for the calculator tool: numbers, + - * / % ^,
 * parentheses, and a few functions. No eval, no variables, no access to
 * anything else.
 */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token =
  | { type: "number"; value: number }
  | { type: "name"; value: string }
  | { type: "symbol"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([a-z_]+)|([-+*/%^(),]))/giy;
  let index = 0;
  while (index < input.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(input);
    if (!match) {
      if (/^\s*$/.test(input.slice(index))) break;
      throw new ToolError(`Unexpected "${input.slice(index).trim()[0]}"`);
    }
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: "number", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: "name", value: match[2].toLowerCase() });
    else if (match[3] !== undefined) tokens.push({ type: "symbol", value: match[3] });
  }
  return tokens;
}

export function evaluateExpression(input: string): number {
  if (input.length > 500) throw new ToolError("The expression is too long");
  const tokens = tokenize(
    input
      .replace(/,(?=\d{3}\b)/g, "")
      .replace(/×/g, "*")
      .replace(/÷/g, "/"),
  );
  let position = 0;
  const peek = () => tokens[position];
  const take = (symbol?: string) => {
    const token = tokens[position];
    if (!token || (symbol && !(token.type === "symbol" && token.value === symbol))) {
      throw new ToolError(symbol ? `Expected "${symbol}"` : "Unexpected end of expression");
    }
    position += 1;
    return token;
  };
  const isSymbol = (value: string) => {
    const token = peek();
    return token?.type === "symbol" && token.value === value;
  };

  // expression := term (("+" | "-") term)*
  const expression = (): number => {
    let value = term();
    while (isSymbol("+") || isSymbol("-"))
      value = take().value === "+" ? value + term() : value - term();
    return value;
  };
  // term := unary (("*" | "/" | "%") unary)*
  const term = (): number => {
    let value = unary();
    while (isSymbol("*") || isSymbol("/") || isSymbol("%")) {
      const operator = take().value;
      const right = unary();
      if ((operator === "/" || operator === "%") && right === 0)
        throw new ToolError("Division by zero");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  };
  // unary := ("-" | "+") unary | power   (so -2^2 is -(2^2), as in maths)
  const unary = (): number => {
    if (isSymbol("-")) return (take(), -unary());
    if (isSymbol("+")) return (take(), unary());
    return power();
  };
  // power := primary ("^" unary)?   (right-associative: 2^3^2 is 2^(3^2))
  const power = (): number => {
    const base = primary();
    return isSymbol("^") ? (take(), base ** unary()) : base;
  };
  const primary = (): number => {
    const token = take();
    if (token.type === "number") return token.value;
    if (token.type === "symbol" && token.value === "(") {
      const value = expression();
      take(")");
      return value;
    }
    if (token.type === "name") {
      if (token.value in CONSTANTS) return CONSTANTS[token.value]!;
      const fn = FUNCTIONS[token.value];
      if (!fn) throw new ToolError(`Unknown function "${token.value}"`);
      take("(");
      const args = [expression()];
      while (isSymbol(",")) {
        take();
        args.push(expression());
      }
      take(")");
      return fn(...args);
    }
    throw new ToolError(`Unexpected "${token.value}"`);
  };

  const result = expression();
  if (position < tokens.length) throw new ToolError(`Unexpected "${String(peek()?.value)}"`);
  if (!Number.isFinite(result)) throw new ToolError("The result isn't a finite number");
  return result;
}
