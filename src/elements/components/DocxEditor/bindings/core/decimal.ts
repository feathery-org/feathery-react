// Base-10 decimal arithmetic on canonical decimal strings.
//
// The engine never uses binary floats for document values. A canonical decimal
// string is: optional "-", one or more digits, optionally "." and one or more
// digits - e.g. "0", "-12", "1800.00", "0.5".
//
// Internally a value is { neg, units, scale }: units is a non-negative BigInt of
// all digits, scale is how many of those digits sit after the decimal point. All
// operations are exact except roundTo (half-up).
//
// Porting note: this module deliberately avoids the `**` operator. The package
// compiles with target es5, where babel downlevels `**` to `Math.pow`, and
// Math.pow on a BigInt throws "Cannot convert a BigInt value to a number" at
// runtime. Every power of ten therefore goes through `pow10` below. BigInt's
// other operators (* / % + - and comparisons) are untouched by the downlevel and
// are safe.

const CANON_RE = /^-?\d+(\.\d+)?$/;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

interface Decimal {
  neg: boolean;
  units: bigint;
  scale: number;
}

/** 10^exponent as a BigInt, without the `**` operator. */
function pow10(exponent: number): bigint {
  let result = ONE;
  for (let i = 0; i < exponent; i++) result = result * TEN;
  return result;
}

export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && CANON_RE.test(value);
}

function parse(value: string): Decimal {
  if (!isDecimalString(value))
    throw new Error(`not a canonical decimal: ${JSON.stringify(value)}`);
  const neg = value[0] === '-';
  const body = neg ? value.slice(1) : value;
  const dot = body.indexOf('.');
  const digits =
    dot === -1 ? body : body.slice(0, dot) + body.slice(dot + 1);
  const scale = dot === -1 ? 0 : body.length - dot - 1;
  return { neg, units: BigInt(digits), scale };
}

function render({ neg, units, scale }: Decimal): string {
  let digits = units.toString();
  if (scale > 0) {
    while (digits.length <= scale) digits = `0${digits}`;
    digits = `${digits.slice(0, digits.length - scale)}.${digits.slice(
      digits.length - scale
    )}`;
  }
  return (neg && units !== ZERO ? '-' : '') + digits;
}

function rescale(value: Decimal, scale: number): Decimal {
  if (scale < value.scale) throw new Error('rescale cannot drop digits');
  return {
    neg: value.neg,
    units: value.units * pow10(scale - value.scale),
    scale
  };
}

function signed(value: Decimal): bigint {
  return value.neg ? -value.units : value.units;
}

function fromSigned(n: bigint, scale: number): Decimal {
  return { neg: n < ZERO, units: n < ZERO ? -n : n, scale };
}

export function add(a: string, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  return render(
    fromSigned(signed(rescale(pa, scale)) + signed(rescale(pb, scale)), scale)
  );
}

export function sub(a: string, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  return render(
    fromSigned(signed(rescale(pa, scale)) - signed(rescale(pb, scale)), scale)
  );
}

export function mul(a: string, b: string): string {
  const pa = parse(a);
  const pb = parse(b);
  return render(fromSigned(signed(pa) * signed(pb), pa.scale + pb.scale));
}

export function sum(values: string[]): string {
  return values.reduce((accumulated, value) => add(accumulated, value), '0');
}

export function cmp(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.scale, pb.scale);
  const sa = signed(rescale(pa, scale));
  const sb = signed(rescale(pb, scale));
  if (sa < sb) return -1;
  return sa > sb ? 1 : 0;
}

/**
 * Round half-up (away from zero) to exactly `scale` fraction digits. The result
 * always carries `scale` digits: roundTo("7800", 2) === "7800.00".
 */
export function roundTo(value: string, scale: number): string {
  const parsed = parse(value);
  if (parsed.scale <= scale) return render(rescale(parsed, scale));
  const drop = pow10(parsed.scale - scale);
  let quotient = parsed.units / drop;
  if ((parsed.units % drop) * TWO >= drop) quotient = quotient + ONE;
  return render({ neg: parsed.neg, units: quotient, scale });
}

/** Strip redundant zeros: "0012.500" -> "12.5", "-0.00" -> "0". */
export function normalize(value: string): string {
  const parsed = parse(value);
  let rendered = render(parsed);
  if (rendered.includes('.'))
    rendered = rendered.replace(/0+$/, '').replace(/\.$/, '');
  rendered = rendered.replace(/^(-?)0+(?=\d)/, '$1');
  if (rendered === '-0') rendered = '0';
  return rendered;
}

/**
 * "1234567.89" -> "1,234,567.89". Display only - a grouped string is not a
 * canonical decimal and must never be fed back into arithmetic.
 */
export function group(value: string): string {
  const parsed = parse(value);
  const rendered = render({ ...parsed, neg: false });
  const [whole, fraction] = rendered.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    (parsed.neg && parsed.units !== ZERO ? '-' : '') +
    grouped +
    (fraction ? `.${fraction}` : '')
  );
}
