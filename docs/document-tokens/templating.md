# Live document tokens — a template author's guide

A **token** is a value in a generated Word document that stays live. Once the
document opens in the editor, the reader can change a token's value in place,
and anything derived from it — a line total, a subtotal, a tax line —
recalculates on the spot. The document is a *view* of the form's field values,
never a second copy of them: change a field and the token follows; change the
token and the field follows.

You author tokens in your `.docx` template. This guide is about how to write
them.

---

## 1. What a token looks like

You mark a token by wrapping a short declaration in double square brackets:

```
[[ company_name ]]
```

When the document is generated, that text is replaced by a **live content
control** bound to the `company_name` form field. In the editor it shows the
field's value; the reader can type a new value, and it is written straight back
to the field.

There are three kinds of token, and you never say which one you want — the
grammar works it out from the name and what follows it:

| You write | What it becomes |
| --- | --- |
| `[[ company_name ]]` | A **field** token — editable, bound to the `company_name` field |
| `[[ greeting ]]` | A **memory** token — editable, but `greeting` is not a field, so it just holds a value in the document |
| `[[ item_total = qty * cost ]]` | A **formula** token — derived, read-only, recomputed whenever its inputs move |

A name that matches a form field is a field token. A name that matches no field
is a memory token. Anything with a formula on the right-hand side is a formula
token.

If the grammar can't read what's inside the brackets, the tag is **declined**:
it renders as ordinary text and the rest of the document still generates. A
template that half-works beats one that refuses to render.

---

## 2. The grammar

The grammar is **name-first**:

```
[[ NAME [= default_or_formula] [| fmt='...'] ]]
```

- `NAME` comes first, always. It must be letters, digits and underscores, start
  with a letter or underscore, and be at most 30 characters.
- `= …` is optional. What follows is either a **default value** (a literal) or
  a **formula** (anything that isn't a complete literal).
- `| fmt='…'` is optional. It sets how the value is displayed. **With no
  `| fmt=`, the format defaults to `text`.**

### Every form, with a copy-pasteable example

**Plain field token** — editable, bound to a field, no default:

```
[[ company_name ]]
```

**Field token with a default** — the field value fills in, but if the field is
empty the default is shown:

```
[[ company_name = 'Hilb' ]]
```

**Memory token** — a name that isn't a field. Editable, holds its value in the
document only. A bare memory name shows nothing until edited; give it a default
to seed it:

```
[[ greeting = 'Hello' ]]
```

**Array default** — for a repeated field, the default can be a list, one entry
per row:

```
[[ cost = [600, 300, 150] ]]
```

**Formula token** — derived and read-only. Any right-hand side that isn't a
complete literal is treated as a formula:

```
[[ item_total = qty * cost ]]
```

**Token with a format** — display as currency, number, or percent:

```
[[ cost | fmt='currency' ]]
```

**Everything at once** — name, default, and format:

```
[[ tax_pct = 13 | fmt='percent' ]]
[[ cost = [600, 300] | fmt='currency' ]]
[[ subtotal = SUM(item_total) | fmt='currency' ]]
```

### Quotes

String literals and the `fmt=` value may use straight or curly quotes — Word
autocorrects `'` to `'`, and both read the same.

### What gets declined

These are not tokens; they render as-is:

```
[[ user.address.city ]]     — a dotted path is Jinja's problem, not a token
[[ = 5 ]]                   — no name
[[ 1name = 'x' ]]           — a name can't start with a digit
[[ cost | fmt= ]]           — a `| fmt=` with nothing after it
[[ total = mystery_a * b ]] — a formula naming something that is neither a field nor another token
```

That last rule matters: **every name a formula references must resolve** — to a
form field, or to another token declared somewhere in the document. A formula
over a typo is declined rather than left permanently unable to compute.

---

## 3. How a token maps to a field

A field token binds by **name**: `[[ cost ]]` reads and writes the `cost` form
field. There is one owner of that value — the form — so the token and every
rendered input for `cost` always agree.

A token in a **table row** binds to a **repeated field**: a field whose value is
an array. The row's position in the table is the token's index, and **the index
is the array position** — row 0 is `cost[0]`, row 1 is `cost[1]`, and so on. A
repeated field that holds a bare scalar (before any repeat exists) counts as
row 0.

You lay repeated tokens out with a docxtpl row loop, one table row per array
element:

```
{%tr for row in range(qty | length) %}
[[ description ]] | [[ qty ]] | [[ cost ]] | [[ item_total = qty * cost ]]
{%tr endfor %}
```

Put another way: whatever tokens the row carries, in whatever columns, each
array element gets its own copy of that row.

---

## 4. Formulas

A formula recomputes automatically. Its language is deliberately tiny, and it is
**not** a programming language — there is no `eval`, no property access, no
string manipulation beyond the display functions below. Anything outside the
grammar is a syntax error.

### Operators

| | |
| --- | --- |
| `+  -  *  /` | Arithmetic. `*` and `/` bind tighter than `+` and `-`. |
| `( )` | Grouping, to override precedence. |
| unary `-` | Negation, e.g. `-a + 10`. |
| numbers | `10`, `1.5`, `-2.5`. |
| token names | `qty`, `unit_cost`, `subtotal`. |

Division by zero is an **error**, not infinity. An unknown name is an
**error**, never a silent zero — so a mistyped reference shows up as a problem
instead of quietly reading as 0.

### Functions

| Function | Meaning |
| --- | --- |
| `SUM(a, b, …)` | Adds its arguments. `SUM()` is 0. |
| `ROUND(x)` / `ROUND(x, n)` | Rounds `x` to `n` decimal places (default 0), **half away from zero** — `ROUND(2.5)` is 3, `ROUND(-2.5)` is -3. |
| `MIN(a, b, …)` | Smallest argument. |
| `MAX(a, b, …)` | Largest argument. |
| `ABS(x)` | Absolute value. |

### Referencing other tokens

A formula names other tokens directly. In a table row, a bare name binds to
that row: `qty * unit_cost` in row 2 uses row 2's `qty` and `unit_cost`. A
scalar formula that names a repeated token sees **every row** of it.

### Summing a column (wildcards / aggregates)

To total a column of a repeated table, either name the repeated token inside
`SUM`, or use a **prefix wildcard** `name*` that expands to every token whose
name starts with that prefix:

```
[[ subtotal = SUM(item_total) ]]        — sums the item_total column, all rows
[[ subtotal = SUM(item_total_*) ]]      — same, by prefix
```

This is what makes the template self-maintaining: add a line item and the
subtotal picks it up with **no formula edit anywhere**. A wildcard matching
nothing sums to 0. `SUM(tax_*)` will not match `taxable_1` — the prefix is
matched exactly.

A wildcard is only valid **inside a function call**. `item_total_* + 1` on its
own is an error.

### How values recompute

Every input change re-evaluates the document in dependency order: each token is
computed only after everything it reads. `qty × cost` runs before the
`SUM(item_total)` that totals it, which runs before the `subtotal + tax` that
uses it. You never order formulas by hand — declare them in any order, even a
subtotal above the rows it sums, and they still resolve correctly.

If one formula can't evaluate (a cycle like `a = b` / `b = a`, or a bad
reference), only that token shows an error. Everything else still computes.

---

## 5. Formats

The `| fmt='…'` option controls **display only** — the underlying value stays a
plain number that other formulas use. A reader may type `$175` or `175` and
mean the same thing; on blur it re-renders in the token's format.

| `fmt` | Default decimals | Example input | Rendered |
| --- | --- | --- | --- |
| `text` (default) | — | `acme corp` | `acme corp` |
| `number` | 0 | `1500` | `1,500` |
| `currency` | 2 | `1500` | `$1,500.00` |
| `currency` (negative) | 2 | `-1500` | `-$1,500.00` |
| `percent` | 2 | `8.25` | `8.25%` |

Notes grounded in how rendering actually works:

- **`text` is the default** and is never reformatted — whatever the reader typed
  is what shows. A `text` token whose value happens to be a number (an
  unformatted `[[ qty ]]`) still feeds formulas as a number; it just isn't
  reformatted for display.
- `number`, `currency`, and `percent` group thousands with commas and pad to
  their decimal count.
- A non-numeric value under a numeric format falls back to showing the raw text
  rather than a bogus `$NaN`.

> Only these four format kinds exist (`text`, `number`, `currency`, `percent`).
> A field-bound token can also inherit its format and constraints from the
> field's own configuration (e.g. a `cost` field set up as Currency); an
> explicit `| fmt=` always wins over the inherited one.

### Display transforms are not formats

`UPPER`, `LOWER`, `TITLE`, and `TRIM` are **formula functions**, not `fmt`
values. They change how text *looks* while the field keeps what the reader
typed — the same way a currency format shows `$30.00` over a stored `30`. A
token whose display transform is `UPPER(name)` shows `ACME` over a field holding
`acme`.

| Function | `acme corp` → |
| --- | --- |
| `UPPER(x)` | `ACME CORP` |
| `LOWER(x)` | `acme corp` |
| `TITLE(x)` | `Acme Corp` (word-initial capitals; apostrophes count as breaks, so `don't` → `Don'T`) |
| `TRIM(x)` | strips surrounding whitespace only |

These are the only functions that operate on text; they can be nested
(`UPPER(TRIM(name))`) but can't be mixed into arithmetic.

---

## 6. Repeated tables

Put tokens in a table row and the table **follows the field's array** while the
document is open:

- **Grow** — add a value to the field and a new row appears, built from the last
  row as a template. The new row carries the same tokens in the same columns,
  with the next index. A freshly grown row starts from its own field value, not
  the template row's — it does **not** inherit the template row's default.
- **Shrink** — remove a value and its row is dropped from the end, so every
  surviving row keeps its index.
- **Delete in the editor** — deleting a row through Word's own table menu
  removes that element from the field too, and the remaining rows renumber so
  index still equals array position.

An empty or new row shows each token's empty rendering — nothing for a `text`
token, `$0.00` for a currency token — rather than a Word placeholder. It's a
real, editable row from the moment it appears.

The table never collapses to zero token rows: the last row is the template every
future row is built from.

---

## 7. Precedence: default vs. field value

A token's authored **default** (`[[ company_name = 'Hilb' ]]`) is seeded **once**
when the document opens — the first time the cycle reads that token. After that,
the field value is the source of truth.

The precedence rule (matching the backend's `TOKEN_DEFAULT_WINS`, currently
**on**) is:

- **Default wins on open.** When the document opens, the authored default is
  written into the field, seeding it. This is "seed-once-on-open".
- **After open, the field wins.** Once seeded, editing the token edits the
  field; the default never comes back. Clearing a value **leaves it cleared** —
  the default does not snap back on the next recalc.
- **Seeding happens once per open.** A default is offered exactly once per
  document open, so a deliberately emptied field stays empty.

A memory token's default simply *is* its value (there's no field behind it).

If two appearances of the same field disagree — a bare `[[ company_name ]]`
elsewhere and a `[[ company_name = 'Hilb' ]]` with a default — the default is
kept, not erased by the bare one.

---

## 8. Worked example: an invoice

A template with a line-item table (`qty`, `unit_cost` repeated fields), a
per-line total, a summed subtotal, a tax line reading a `tax_percent` field,
and a grand total:

```
Line items:
{%tr for row in range(qty | length) %}
  [[ qty | fmt='number' ]]  ×  [[ unit_cost | fmt='currency' ]]  =  [[ item_total = qty * unit_cost | fmt='currency' ]]
{%tr endfor %}

Subtotal:  [[ subtotal = SUM(item_total)                          | fmt='currency' ]]
Tax:       [[ tax_amount = ROUND(subtotal * tax_percent / 100, 2) | fmt='currency' ]]
Total:     [[ total = subtotal + tax_amount                       | fmt='currency' ]]
```

With `qty = [10, 2]`, `unit_cost = [150, 400]`, `tax_percent = 8.25`:

| Token | Value |
| --- | --- |
| `item_total` row 0 | `$1,500.00` |
| `item_total` row 1 | `$800.00` |
| `subtotal` | `$2,300.00` |
| `tax_amount` | `$189.75` |
| `total` | `$2,489.75` |

Change `qty` row 0 to `20` in the editor and, in one step: `item_total` row 0 →
`$3,000.00`, `subtotal` → `$3,800.00`, `total` → `$4,113.50`. The untouched
row 1 stays `$800.00`.

`tax_percent` here has no token of its own — it's a field the `tax_amount`
formula reads. The value still moves when that field changes.

---

## 9. Troubleshooting

**A currency token shows `$0.00`.** Its formula couldn't find a value, so it
rendered the 0 fallback. Usually a name mismatch: the formula references `qty`
but the field or token is spelled differently, or an input token was left as
`text` with a non-numeric value. Check that every name in the formula resolves
to a field or another token. (A document with a token whose formula can't
evaluate is blocked from saving, so this surfaces rather than shipping silently.)

**A token shows Word's placeholder** ("Click here or tap to insert text"). The
control was emptied — often by an undo — and Word dropped in its own
placeholder. It's not a value; clicking elsewhere (a blur) or any field change
reconciles it back to the real value. If it persists on a freshly grown row, the
row's tokens didn't all build — check the console for a "built N of M tokens"
warning.

**A tag rendered as plain text instead of becoming a token.** It was declined.
Common causes: a dotted name (`user.address.city`), a name starting with a
digit, a formula referencing something that's neither a field nor a declared
token, or a stray `| fmt=` with no value. Declined tags are reported on upload —
check the template warnings.

**A row didn't sync.** Rows follow the field's array. If a new field value
didn't add a row, confirm the table actually contains token controls in its rows
(the last row is used as the template — an all-static table can't grow) and that
the field key backing the row matches the token names. Deleting a row in the
editor removes it from the field only if the tokens in it are field-backed.

**A number won't accept what I type.** Numeric tokens (`currency`, `number`,
`percent`) reject characters they could never hold — letters are refused at the
keystroke. Type digits, `.`, `,`, `-`, `$`, or `%`.
