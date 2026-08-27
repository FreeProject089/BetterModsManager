//! BMMScript — writing an automation as code instead of as bricks.
//!
//! # Why this compiles instead of interpreting
//!
//! The bricks already have a complete engine: 73 actions, 28 conditions, 13 step kinds, a
//! permission model, variables, and a runner that has been debugged against real tasks. A
//! second engine would mean re-exposing every one of those by hand, and then keeping the
//! two in agreement forever — which, in a codebase that already carries `REF_ACTIONS` three
//! times and has a checker for the drift, is a promise nobody can keep.
//!
//! So this is a COMPILER, not an interpreter. It parses text and emits the exact same
//! `Step` JSON the brick editor produces. Three things fall out of that, and they are the
//! reason for the design:
//!
//!   * **Completeness is automatic.** `do <name>(k: v)` lowers to `{type: name, params}`,
//!     so every action that exists is already writable — including ones added after this
//!     file was written. The language never needs a list of actions, and cannot fall behind
//!     one.
//!   * **Round trip.** Because code and bricks are the same tree, a task written in either
//!     can be opened in the other. `decompile` is the other direction, and the tests below
//!     assert that source → tree → source is stable.
//!   * **One runner.** Permissions, variable substitution, loop caps and error handling are
//!     whatever the brick runner already does. Code cannot acquire a capability bricks do
//!     not have, which is also the honest security answer.
//!
//! # What it deliberately does not do
//!
//! No expressions, no user-defined functions, no recursion. A step is a step. Arithmetic
//! lives where it already lives — the `math.set` action — because inventing a second
//! evaluator here would be the very drift this design exists to avoid. Those are the
//! capabilities to add on top later, as an extension, not as a reason to rebuild the base.
//!
//! # Errors
//!
//! Every diagnostic carries a line and a column, because this text is typed into an editor
//! and "syntax error" with no position is a worse experience than no editor at all.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub line: usize,
    pub col: usize,
    pub message: String,
}

impl Diagnostic {
    fn at(tok: &Token, message: impl Into<String>) -> Self {
        Diagnostic {
            line: tok.line,
            col: tok.col,
            message: message.into(),
        }
    }
}

type PResult<T> = Result<T, Diagnostic>;

// ─────────────────────────────────────────────────────────────────────────────
// Lexer
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    /// A bare word: a keyword, an action name, a parameter name. Keywords are not
    /// reserved — `notify` is an action and `stop` is a statement, and an action called
    /// `stop` would still be reachable as `do stop()`. Reserving words would mean the
    /// language could be broken by adding an action, which is exactly backwards.
    Word(String),
    Str(String),
    Num(f64),
    /// A duration written as `30s` / `5m` / `2h`, already normalised to seconds.
    Dur(f64),
    /// `03:00`
    Time(String),
    LBrace,
    RBrace,
    LParen,
    RParen,
    Colon,
    Comma,
    /// `=`, for `set x = …`.
    Assign,
    /// A comparison: `==` `!=` `>` `>=` `<` `<=`. Lowered to the `value` condition.
    Cmp(String),
    /// An arithmetic character. Never interpreted here — the right-hand side of a `set` is
    /// sliced from the SOURCE and handed to the runner's own evaluator. This exists only so
    /// the lexer can walk past them to find where the line ends.
    Op(char),
    /// A character this language has no meaning for.
    ///
    /// NOT an error at lex time, and that is the point: the lexer runs over the WHOLE file
    /// before the parser slices a `script bash { … }` body out of it by offset, so it has to
    /// walk past `*.zip`, `$f` and `;` without refusing. It became a token after exactly
    /// that — a documented bash example would not compile because of the dot in `*.zip`,
    /// inside a block whose contents this language never reads.
    ///
    /// The parser still refuses one anywhere it matters, with the same message as before.
    Unknown(char),
    Eof,
}

#[derive(Debug, Clone)]
struct Token {
    tok: Tok,
    line: usize,
    col: usize,
    /// Character offset of the token's FIRST char, and one past its last.
    ///
    /// Carried so the right-hand side of `set x = …` can be taken as raw source instead of
    /// re-serialised from tokens. evalExpr in the runner has its own tokenizer; handing it
    /// the user's exact text is the only way the two cannot disagree about precedence.
    start: usize,
    end: usize,
}

fn lex(src: &str) -> PResult<Vec<Token>> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let (mut i, mut line, mut col) = (0usize, 1usize, 1usize);
    // The current token's start offset. Outside the loop because the macro is also used for
    // the final Eof push, where there is no iteration to scope it to.
    let mut si = 0usize;

    macro_rules! push {
        ($t:expr, $l:expr, $c:expr) => {
            out.push(Token {
                tok: $t,
                line: $l,
                col: $c,
                start: si,
                end: i,
            })
        };
    }

    while i < chars.len() {
        let c = chars[i];
        let (sl, sc) = (line, col);
        si = i;

        // whitespace
        if c == '\n' {
            i += 1;
            line += 1;
            col = 1;
            continue;
        }
        if c.is_whitespace() {
            i += 1;
            col += 1;
            continue;
        }
        // comments: `//` to end of line, and `#` because half the people who will write
        // this have come from a shell and will type it without thinking.
        if c == '#' || (c == '/' && chars.get(i + 1) == Some(&'/')) {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        match c {
            '{' => {
                i += 1;
                col += 1;
                push!(Tok::LBrace, sl, sc);
            }
            '}' => {
                i += 1;
                col += 1;
                push!(Tok::RBrace, sl, sc);
            }
            '(' => {
                i += 1;
                col += 1;
                push!(Tok::LParen, sl, sc);
            }
            ')' => {
                i += 1;
                col += 1;
                push!(Tok::RParen, sl, sc);
            }
            ',' => {
                i += 1;
                col += 1;
                push!(Tok::Comma, sl, sc);
            }
            ':' => {
                i += 1;
                col += 1;
                push!(Tok::Colon, sl, sc);
            }
            '+' | '*' | '/' | '%' | '^' | '-' => {
                i += 1;
                col += 1;
                push!(Tok::Op(c), sl, sc);
            }
            '=' | '!' | '<' | '>' => {
                // Two-character forms first: `>` would otherwise swallow the `=` of `>=`.
                let two = chars.get(i + 1) == Some(&'=');
                if two {
                    let op: String = chars[i..i + 2].iter().collect();
                    i += 2;
                    col += 2;
                    push!(Tok::Cmp(op), sl, sc);
                } else if c == '=' {
                    i += 1;
                    col += 1;
                    push!(Tok::Assign, sl, sc);
                } else if c == '!' {
                    return Err(Diagnostic {
                        line: sl,
                        col: sc,
                        message:
                            "`!` on its own means nothing \u{2014} did you mean `!=`, or `not`?"
                                .into(),
                    });
                } else {
                    let op = c.to_string();
                    i += 1;
                    col += 1;
                    push!(Tok::Cmp(op), sl, sc);
                }
            }
            '"' | '\'' => {
                let quote = c;
                i += 1;
                col += 1;
                let mut s = String::new();
                loop {
                    if i >= chars.len() {
                        return Err(Diagnostic {
                            line: sl,
                            col: sc,
                            message: "This text is never closed — add the matching quote.".into(),
                        });
                    }
                    let ch = chars[i];
                    if ch == '\\' && i + 1 < chars.len() {
                        // Only the escapes a person actually types. An unknown one keeps
                        // BOTH characters rather than silently eating the backslash: a
                        // Windows path is the most common string here, and "C:\\mods" must
                        // not quietly become "C:mods".
                        let n = chars[i + 1];
                        match n {
                            'n' => s.push('\n'),
                            't' => s.push('\t'),
                            '\\' => s.push('\\'),
                            '"' => s.push('"'),
                            '\'' => s.push('\''),
                            other => {
                                s.push('\\');
                                s.push(other);
                            }
                        }
                        i += 2;
                        col += 2;
                        continue;
                    }
                    if ch == quote {
                        i += 1;
                        col += 1;
                        break;
                    }
                    if ch == '\n' {
                        line += 1;
                        col = 1;
                    } else {
                        col += 1;
                    }
                    s.push(ch);
                    i += 1;
                }
                push!(Tok::Str(s), sl, sc);
            }
            _ if c.is_ascii_digit() => {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                    col += 1;
                }
                let text: String = chars[start..i].iter().collect();
                // `03:00` — a time, not a number followed by a colon. Decided here because
                // the parser would otherwise have to un-read a token to tell them apart.
                if i < chars.len()
                    && chars[i] == ':'
                    && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit())
                {
                    let mut j = i + 1;
                    while j < chars.len() && chars[j].is_ascii_digit() {
                        j += 1;
                    }
                    let mins: String = chars[i + 1..j].iter().collect();
                    col += j - i;
                    i = j;
                    push!(Tok::Time(format!("{:0>2}:{:0>2}", text, mins)), sl, sc);
                    continue;
                }
                let n: f64 = text.parse().map_err(|_| Diagnostic {
                    line: sl,
                    col: sc,
                    message: format!("`{}` is not a number.", text),
                })?;
                // A unit glued to the number makes it a duration.
                if let Some(&u) = chars.get(i) {
                    if matches!(u, 's' | 'm' | 'h')
                        && !chars
                            .get(i + 1)
                            .is_some_and(|x| x.is_alphanumeric() || *x == '_')
                    {
                        i += 1;
                        col += 1;
                        let secs = match u {
                            's' => n,
                            'm' => n * 60.0,
                            _ => n * 3600.0,
                        };
                        push!(Tok::Dur(secs), sl, sc);
                        continue;
                    }
                }
                push!(Tok::Num(n), sl, sc);
            }
            _ if c.is_alphabetic() || c == '_' => {
                let start = i;
                // A dot is part of the word: action names ARE dotted (`mod.enable`), and
                // splitting them would make every action a three-token sequence.
                // NOT '-': it is arithmetic now. No action or condition among the 103
                // that exist has a hyphen, and allowing it made `count-1` one word.
                while i < chars.len()
                    && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.')
                {
                    i += 1;
                    col += 1;
                }
                push!(Tok::Word(chars[start..i].iter().collect()), sl, sc);
            }
            other => {
                i += 1;
                col += 1;
                push!(Tok::Unknown(other), sl, sc);
            }
        }
    }
    push!(Tok::Eof, line, col);
    Ok(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser → the brick tree
// ─────────────────────────────────────────────────────────────────────────────

struct P {
    toks: Vec<Token>,
    i: usize,
    /// The original text, so `set x = …` can take its right-hand side verbatim.
    src: Vec<char>,
}

impl P {
    fn peek(&self) -> &Token {
        &self.toks[self.i.min(self.toks.len() - 1)]
    }
    fn next(&mut self) -> Token {
        let t = self.toks[self.i.min(self.toks.len() - 1)].clone();
        if self.i < self.toks.len() - 1 {
            self.i += 1;
        }
        t
    }
    fn at_word(&self, w: &str) -> bool {
        matches!(&self.peek().tok, Tok::Word(x) if x.eq_ignore_ascii_case(w))
    }
    fn eat_word(&mut self, w: &str) -> bool {
        if self.at_word(w) {
            self.next();
            true
        } else {
            false
        }
    }
    fn expect(&mut self, t: Tok, what: &str) -> PResult<Token> {
        if self.peek().tok == t {
            Ok(self.next())
        } else {
            let got = self.peek().clone();
            Err(Diagnostic::at(&got, format!("Expected {} here.", what)))
        }
    }
    fn word(&mut self, what: &str) -> PResult<String> {
        match self.peek().tok.clone() {
            Tok::Word(w) => {
                self.next();
                Ok(w)
            }
            _ => {
                let got = self.peek().clone();
                Err(Diagnostic::at(&got, format!("Expected {} here.", what)))
            }
        }
    }
    fn string(&mut self, what: &str) -> PResult<String> {
        match self.peek().tok.clone() {
            Tok::Str(s) => {
                self.next();
                Ok(s)
            }
            _ => {
                let got = self.peek().clone();
                Err(Diagnostic::at(
                    &got,
                    format!("Expected {} in quotes here.", what),
                ))
            }
        }
    }

    // ── arguments: `key: value, key: value` ─────────────────────────────
    fn args(&mut self) -> PResult<Map<String, Value>> {
        let mut m = Map::new();
        self.expect(Tok::LParen, "an opening bracket")?;
        if self.peek().tok == Tok::RParen {
            self.next();
            return Ok(m);
        }
        loop {
            let keytok = self.peek().clone();
            let key = self.word("a parameter name")?;
            self.expect(Tok::Colon, "a colon after the parameter name")?;
            let v = match self.peek().tok.clone() {
                Tok::Str(s) => {
                    self.next();
                    Value::String(s)
                }
                Tok::Num(n) => {
                    self.next();
                    num(n)
                }
                Tok::Dur(secs) => {
                    self.next();
                    num(secs)
                }
                Tok::Time(t) => {
                    self.next();
                    Value::String(t)
                }
                Tok::Word(w) => {
                    self.next();
                    match w.as_str() {
                        "true" => Value::Bool(true),
                        "false" => Value::Bool(false),
                        // A bare word is a string. Every param the brick editor produces is
                        // a string, a number or a bool, so there is nothing else it could
                        // be — and quoting `powershell` would be noise.
                        _ => Value::String(w),
                    }
                }
                _ => return Err(Diagnostic::at(&keytok, "This parameter has no value.")),
            };
            if m.insert(key.clone(), v).is_some() {
                return Err(Diagnostic::at(
                    &keytok,
                    format!("`{}` is given twice.", key),
                ));
            }
            if self.peek().tok == Tok::Comma {
                self.next();
                continue;
            }
            break;
        }
        self.expect(Tok::RParen, "a closing bracket")?;
        Ok(m)
    }

    // ── conditions ──────────────────────────────────────────────────────
    //
    // `and` / `or` lower to the existing `all` / `any` conditions rather than to a new
    // node type, so a condition written in code is the same object the brick editor edits.
    fn cond(&mut self) -> PResult<Value> {
        let mut left = self.cond_unary()?;
        loop {
            let joiner = if self.at_word("and") {
                "all"
            } else if self.at_word("or") {
                "any"
            } else {
                break;
            };
            self.next();
            let right = self.cond_unary()?;
            // Flattened when the left side is already the same joiner: `a and b and c` is
            // one `all` of three, not a tree of twos, which is what the editor shows.
            let mut list = match (&left, joiner) {
                (Value::Object(o), j)
                    if o.get("type").and_then(|t| t.as_str()) == Some(j)
                        && o.get("negate") != Some(&Value::Bool(true)) =>
                {
                    o.get("params")
                        .and_then(|p| p.get("conditions"))
                        .and_then(|c| c.as_array())
                        .cloned()
                        .unwrap_or_default()
                }
                _ => vec![left.clone()],
            };
            list.push(right);
            left = json!({ "type": joiner, "params": { "conditions": list } });
        }
        Ok(left)
    }

    fn cond_unary(&mut self) -> PResult<Value> {
        let negate = self.eat_word("not");
        let mut c = if self.peek().tok == Tok::LParen {
            self.next();
            let inner = self.cond()?;
            self.expect(Tok::RParen, "a closing bracket")?;
            inner
        } else {
            let name = self.word("a condition")?;
            // `count > 3` — a comparison, not a condition called `count`. Lowered to the
            // `value` condition, which is exactly what the brick editor's compare row
            // produces, so it opens there as a compare row rather than as something odd.
            if let Tok::Cmp(op) = self.peek().tok.clone() {
                self.next();
                let rhs = match self.peek().tok.clone() {
                    Tok::Num(n) => {
                        self.next();
                        num(n)
                    }
                    Tok::Dur(d) => {
                        self.next();
                        num(d)
                    }
                    Tok::Str(t) => {
                        self.next();
                        Value::String(t)
                    }
                    Tok::Word(w) => {
                        self.next();
                        Value::String(w)
                    }
                    _ => {
                        let got = self.peek().clone();
                        return Err(Diagnostic::at(
                            &got,
                            "Expected something to compare against.",
                        ));
                    }
                };
                json!({ "type": "value", "params": { "source": name, "op": op, "value": rhs } })
            } else {
                let params = if self.peek().tok == Tok::LParen {
                    self.args()?
                } else {
                    Map::new()
                };
                json!({ "type": name, "params": Value::Object(params) })
            }
        };
        if negate {
            // Set on the node itself, which is what the editor's "not" checkbox writes.
            if let Value::Object(o) = &mut c {
                let already = o.get("negate") == Some(&Value::Bool(true));
                o.insert("negate".into(), Value::Bool(!already));
            }
        }
        Ok(c)
    }

    // ── statements ──────────────────────────────────────────────────────
    fn block(&mut self) -> PResult<Vec<Value>> {
        self.expect(Tok::LBrace, "an opening brace")?;
        let mut out = Vec::new();
        while self.peek().tok != Tok::RBrace {
            if self.peek().tok == Tok::Eof {
                let got = self.peek().clone();
                return Err(Diagnostic::at(
                    &got,
                    "This block is never closed — add the matching `}`.",
                ));
            }
            out.push(self.stmt()?);
        }
        self.next();
        Ok(out)
    }

    fn duration(&mut self, what: &str) -> PResult<f64> {
        match self.peek().tok.clone() {
            Tok::Dur(s) => {
                self.next();
                Ok(s)
            }
            // A bare number is seconds. Writing `wait 30` and meaning half a minute is the
            // obvious reading, and refusing it would be pedantry.
            Tok::Num(n) => {
                self.next();
                Ok(n)
            }
            _ => {
                let got = self.peek().clone();
                Err(Diagnostic::at(
                    &got,
                    format!("Expected {} — a number, or one like 30s / 5m / 2h.", what),
                ))
            }
        }
    }

    /// The right-hand side of `set x = …`, as the user typed it.
    ///
    /// Taken from the SOURCE, not rebuilt from tokens. The runner's evalExpr has its own
    /// tokenizer; handing it the original text is the only way the two cannot disagree
    /// about precedence or about what a name is. Ends at the newline, which is also why
    /// an expression cannot be wrapped across lines — a deliberate limit, since the
    /// alternative is guessing where a statement ends.
    fn raw_expr(&mut self) -> PResult<String> {
        let start_tok = self.peek().clone();
        let line = start_tok.line;
        let from = start_tok.start;
        let mut to = from;
        while self.peek().tok != Tok::Eof && self.peek().line == line {
            // A closing brace on the same line belongs to the block, not to the expression:
            // `repeat 2 times { set x = 1 }` must not swallow the `}`.
            if matches!(self.peek().tok, Tok::RBrace) {
                break;
            }
            to = self.peek().end;
            self.next();
        }
        let text: String = self.src[from..to].iter().collect();
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err(Diagnostic::at(&start_tok, "This `set` has no value."));
        }
        Ok(text)
    }

    /// The text between a matching pair of braces, verbatim.
    ///
    /// For `script <engine> { … }`, whose body is somebody else's language and must not be
    /// touched. Brace depth rather than the first `}`, so a shell function or a JSON literal
    /// inside the script does not end it early. Nothing is unescaped: what is between the
    /// braces is what reaches the interpreter.
    fn raw_block(&mut self) -> PResult<String> {
        let open = self.expect(Tok::LBrace, "an opening brace")?;
        let from = open.end;
        let mut depth = 1usize;
        loop {
            match self.peek().tok {
                Tok::Eof => {
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(
                        &got,
                        "This script block is never closed \u{2014} add the matching `}`.",
                    ));
                }
                Tok::LBrace => depth += 1,
                Tok::RBrace => {
                    depth -= 1;
                    if depth == 0 {
                        let close = self.next();
                        let text: String = self.src[from..close.start].iter().collect();
                        // DEDENTED by the common leading whitespace, then re-indented when
                        // printed. Keeping the raw indentation looked safer and was not: the
                        // printer adds the block's own indent on top, so a round trip grew the
                        // body by four spaces every time.
                        //
                        // The COMMON prefix only, so the RELATIVE shape is untouched — which
                        // is the part Python actually cares about.
                        let body = text.trim_matches('\n').trim_end();
                        let indent = body
                            .lines()
                            .filter(|l| !l.trim().is_empty())
                            .map(|l| l.len() - l.trim_start().len())
                            .min()
                            .unwrap_or(0);
                        let dedented: Vec<String> = body
                            .lines()
                            .map(|l| {
                                if l.len() >= indent {
                                    l[indent..].to_string()
                                } else {
                                    l.trim_start().to_string()
                                }
                            })
                            .collect();
                        return Ok(dedented
                            .join(
                                "
",
                            )
                            .trim_end()
                            .to_string());
                    }
                }
                _ => {}
            }
            self.next();
        }
    }

    fn stmt(&mut self) -> PResult<Value> {
        let head = self.peek().clone();
        let w = match &head.tok {
            Tok::Word(w) => w.to_lowercase(),
            // Named with the character: "expected a statement" for a stray `$` sends
            // somebody looking at the wrong thing.
            Tok::Unknown(c) => {
                return Err(Diagnostic::at(
                    &head,
                    format!("`{}` does not mean anything here.", c),
                ))
            }
            _ => return Err(Diagnostic::at(&head, "Expected a statement here.")),
        };

        match w.as_str() {
            "do" => {
                self.next();
                let name = self.word("an action name")?;
                let params = if self.peek().tok == Tok::LParen {
                    self.args()?
                } else {
                    Map::new()
                };
                Ok(
                    json!({ "kind": "action", "action": { "type": name, "params": Value::Object(params) } }),
                )
            }
            "if" => {
                self.next();
                let condition = self.cond()?;
                let then = self.block()?;
                let els = if self.eat_word("else") {
                    // `else if` chains without a special case: the else branch is a block
                    // holding one `if`, which is exactly how the editor nests them.
                    if self.at_word("if") {
                        vec![self.stmt()?]
                    } else {
                        self.block()?
                    }
                } else {
                    Vec::new()
                };
                Ok(json!({ "kind": "if", "condition": condition, "then": then, "else": els }))
            }
            "for" => {
                self.next();
                // `for x in mods` — the loop variable is written for readability and is not
                // used: the runner exposes the item as {item.id} / {item.name}, and
                // inventing a second name for it here would be a name that does nothing.
                let _var = self.word("a name for each item")?;
                if !self.eat_word("in") {
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(&got, "Expected `in` after the item name."));
                }
                let source = self.word("what to loop over")?;
                let list_name = if source == "list" || source == "mapKeys" {
                    Some(self.string("the list name")?)
                } else {
                    None
                };
                let steps = self.block()?;
                let mut o = json!({ "kind": "forEach", "source": source, "maxIters": 500, "everySec": 0, "steps": steps });
                if let Some(n) = list_name {
                    o["listName"] = Value::String(n);
                }
                Ok(o)
            }
            "repeat" => {
                self.next();
                if self.at_word("while") || self.at_word("until") {
                    let mode = self.word("while or until")?.to_lowercase();
                    let condition = self.cond()?;
                    let steps = self.block()?;
                    Ok(
                        json!({ "kind": "repeat", "mode": mode, "condition": condition, "maxIters": 500, "everySec": 0, "steps": steps }),
                    )
                } else {
                    let n = match self.peek().tok.clone() {
                        Tok::Num(n) => {
                            self.next();
                            n
                        }
                        _ => {
                            let got = self.peek().clone();
                            return Err(Diagnostic::at(
                                &got,
                                "Expected `while`, `until`, or a number of times.",
                            ));
                        }
                    };
                    if !self.eat_word("times") {
                        let got = self.peek().clone();
                        return Err(Diagnostic::at(&got, "Expected `times` after the number."));
                    }
                    let steps = self.block()?;
                    Ok(
                        json!({ "kind": "repeat", "mode": "times", "times": num(n), "maxIters": 500, "everySec": 0, "steps": steps }),
                    )
                }
            }
            "wait" => {
                self.next();
                let secs = self.duration("how long to wait")?;
                Ok(json!({ "kind": "delay", "seconds": num(secs) }))
            }
            "waitfor" => {
                self.next();
                let condition = self.cond()?;
                let mut timeout = 60.0;
                let mut poll = 2.0;
                let mut on_timeout = "abort";
                loop {
                    if self.eat_word("timeout") {
                        timeout = self.duration("a timeout")?;
                        continue;
                    }
                    if self.eat_word("poll") {
                        poll = self.duration("a poll interval")?;
                        continue;
                    }
                    if self.eat_word("orcontinue") {
                        on_timeout = "continue";
                        continue;
                    }
                    break;
                }
                Ok(
                    json!({ "kind": "waitFor", "condition": condition, "timeoutSec": num(timeout), "pollSec": num(poll), "onTimeout": on_timeout }),
                )
            }
            // `retry 3 times every 30s { … }` — run it again when it fails.
            //
            // People were building this out of two tasks that call each other, which is why
            // the export walker has a `seen` set. That works and it costs two tasks, a shared
            // counter and a reader who has to hold both in their head to see one loop.
            //
            // A repo that is briefly unreachable is the case: not an error to handle, an
            // attempt to make again.
            "retry" => {
                self.next();
                let times = match self.peek().tok.clone() {
                    Tok::Num(n) => {
                        self.next();
                        n as i64
                    }
                    _ => {
                        let got = self.peek().clone();
                        return Err(Diagnostic::at(&got, "Expected how many attempts, like `retry 3 times`."));
                    }
                };
                // `times` reads as a word here for the same reason it does after `repeat`.
                let _ = self.eat_word("times");
                let mut every = 5.0;
                if self.eat_word("every") {
                    every = self.duration("how long between attempts")?;
                }
                let steps = self.block()?;
                let on_fail = if self.eat_word("orcontinue") { "continue" } else { "abort" };
                Ok(json!({
                    "kind": "retry",
                    "times": times.max(1),
                    "everySec": num(every),
                    "steps": steps,
                    "onFail": on_fail
                }))
            }
            // `ensure <cond> { … }` — for a task whose job is a STATE rather than a script.
            //
            // Not sugar for `if not <cond>`. An `if` runs its block and never looks back, so a
            // fix that did not take is indistinguishable from one that did. This re-checks
            // afterwards and fails loudly when the condition is STILL false: the whole point of
            // a task that runs every hour is that it tells you when it stopped being able to do
            // its job, and a silent no-op is the failure nobody sees for a month.
            //
            // `orcontinue` keeps the run going after a failed ensure, for a task that ensures
            // several independent things and wants all of them attempted.
            "ensure" => {
                self.next();
                let condition = self.cond()?;
                let steps = self.block()?;
                let on_fail = if self.eat_word("orcontinue") { "continue" } else { "abort" };
                Ok(json!({ "kind": "ensure", "condition": condition, "steps": steps, "onFail": on_fail }))
            }
            "try" => {
                self.next();
                let steps = self.block()?;
                if !self.eat_word("catch") {
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(
                        &got,
                        "Expected `catch` after the try block.",
                    ));
                }
                let on_error = self.block()?;
                Ok(json!({ "kind": "try", "steps": steps, "onError": on_error }))
            }
            "switch" => {
                self.next();
                self.expect(Tok::LBrace, "an opening brace")?;
                let mut cases = Vec::new();
                let mut default = Vec::new();
                loop {
                    if self.eat_word("case") {
                        let condition = self.cond()?;
                        let steps = self.block()?;
                        cases.push(json!({ "condition": condition, "steps": steps }));
                        continue;
                    }
                    if self.eat_word("default") {
                        default = self.block()?;
                        continue;
                    }
                    break;
                }
                self.expect(Tok::RBrace, "a closing brace")?;
                Ok(json!({ "kind": "switch", "cases": cases, "default": default }))
            }
            "call" => {
                self.next();
                let block = self.string("the block name")?;
                Ok(json!({ "kind": "call", "block": block }))
            }
            // `print "…"` — a line in the run log, and in the task's log file when it keeps one.
            //
            // Sugar over `log.print`, the same way `set` is sugar over `var.set`: one word for
            // the thing people write twenty times while working out why a task did what it did.
            // Writing it as a statement rather than only as an action is the difference between
            // a language you debug in and one you debug by staring at.
            "print" => {
                self.next();
                let text = self.string("something to print")?;
                Ok(json!({
                    "kind": "action",
                    "action": { "type": "log.print", "params": { "text": text } }
                }))
            }
            "set" | "shared" => {
                // `shared set x = "…"` writes the variable every task can read.
                let shared = w == "shared";
                self.next();
                if shared && !self.eat_word("set") {
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(&got, "Expected `set` after `shared`."));
                }
                let nametok = self.peek().clone();
                let name = self.word("a variable name")?;
                if !name
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_alphabetic() || c == '_')
                    || !name.chars().all(|c| c.is_alphanumeric() || c == '_')
                {
                    // Refused here rather than at run time, where var.set throws. A name the
                    // substituter cannot match back would store something permanently
                    // unreadable — it looks saved and can never be read.
                    return Err(Diagnostic::at(
                        &nametok,
                        format!("`{}` is not a usable variable name — letters, digits and _ only, starting with a letter.", name),
                    ));
                }
                // An OPTIONAL declared type: `set n: number = 0`. Checked here, where the
                // answer is already known from the shape of the value — the runner has no
                // types at run time, so this is the only place the mistake can be caught at
                // all. It also documents the variable for the next reader, which is most of
                // what an annotation is for in a script this size.
                let declared = if self.peek().tok == Tok::Colon {
                    self.next();
                    let tytok = self.peek().clone();
                    let ty = self.word("a type")?;
                    match ty.as_str() {
                        "number" | "text" => Some((ty, tytok)),
                        other => {
                            return Err(Diagnostic::at(
                                &tytok,
                                format!(
                                    "`{}` is not a type. There are two: number and text.",
                                    other
                                ),
                            ))
                        }
                    }
                } else {
                    None
                };
                self.expect(Tok::Assign, "an `=` after the variable name")?;

                // TEXT if the value is a quoted string; a NUMBER otherwise. That is the
                // whole rule, and it is the one a reader guesses: `set n = 0` counts,
                // `set s = "0"` is the character zero.
                if let Tok::Str(text) = self.peek().tok.clone() {
                    if let Some((ty, tok)) = &declared {
                        if ty == "number" {
                            return Err(Diagnostic::at(
                                tok,
                                "This is declared `number`, but the value is text in quotes.",
                            ));
                        }
                    }
                    self.next();
                    let mut params = json!({ "name": name, "value": text });
                    if shared {
                        params["scope"] = Value::String("shared".into());
                    }
                    return Ok(
                        json!({ "kind": "action", "action": { "type": "var.set", "params": params } }),
                    );
                }
                if shared {
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(
                        &got,
                        "A shared variable holds text — put the value in quotes.",
                    ));
                }
                if let Some((ty, tok)) = &declared {
                    if ty == "text" {
                        return Err(Diagnostic::at(
                            tok,
                            "This is declared `text`, so put the value in quotes.",
                        ));
                    }
                }
                let expr = self.raw_expr()?;
                Ok(
                    json!({ "kind": "action", "action": { "type": "math.set", "params": { "target": name, "expr": expr } } }),
                )
            }
            "parallel" => {
                self.next();
                // `settle` reads as an option on the statement rather than a second keyword:
                // `parallel settle { … }`.
                let mode = if self.eat_word("settle") {
                    "settle"
                } else {
                    "all"
                };
                self.expect(Tok::LBrace, "an opening brace")?;
                let mut branches: Vec<Value> = Vec::new();
                while self.at_word("branch") {
                    self.next();
                    branches.push(Value::Array(self.block()?));
                }
                self.expect(Tok::RBrace, "a closing brace")?;
                if branches.len() < 2 {
                    // One branch is a sequence with extra words, and zero is a step that does
                    // nothing. Both are almost certainly a mistake, and both look fine.
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(
                        &got,
                        "A `parallel` needs at least two `branch { … }` blocks.",
                    ));
                }
                Ok(json!({ "kind": "parallel", "mode": mode, "branches": branches }))
            }
            "spawn" | "run" => {
                // Two words because they are genuinely different: `run` waits for the task and
                // records whether it worked, `spawn` starts it and moves on. Collapsing them
                // into one with a flag would hide the only thing worth choosing between.
                let waits = w == "run";
                self.next();
                let id = self.string("the task name or id")?;
                let ty = if waits { "task.run" } else { "task.spawn" };
                Ok(json!({ "kind": "action", "action": { "type": ty, "params": { "id": id } } }))
            }
            "script" => {
                self.next();
                let engtok = self.peek().clone();
                let engine = self.word("a language")?;
                const ENGINES: [&str; 6] = ["powershell", "cmd", "bash", "python", "node", "rust"];
                if !ENGINES.contains(&engine.as_str()) {
                    return Err(Diagnostic::at(
                        &engtok,
                        format!(
                            "`{}` is not a script language. They are: {}.",
                            engine,
                            ENGINES.join(", ")
                        ),
                    ));
                }
                let code = self.raw_block()?;
                if code.trim().is_empty() {
                    return Err(Diagnostic::at(&engtok, "This script block is empty."));
                }
                Ok(
                    json!({ "kind": "action", "action": { "type": "custom.script", "params": { "engine": engine, "code": code } } }),
                )
            }
            "clear" => {
                self.next();
                let name = self.word("a variable name")?;
                Ok(
                    json!({ "kind": "action", "action": { "type": "var.clear", "params": { "name": name } } }),
                )
            }
            "break" => {
                self.next();
                Ok(json!({ "kind": "break" }))
            }
            "continue" => {
                self.next();
                Ok(json!({ "kind": "continue" }))
            }
            "stop" => {
                self.next();
                Ok(json!({ "kind": "stop" }))
            }
            _ => Err(Diagnostic::at(
                &head,
                format!(
                    "`{}` is not a statement. Actions are written `do {}(...)`.",
                    w, w
                ),
            )),
        }
    }

    // ── a whole task ────────────────────────────────────────────────────
    fn task(&mut self) -> PResult<Value> {
        if !self.eat_word("task") {
            let got = self.peek().clone();
            return Err(Diagnostic::at(
                &got,
                "A file starts with `task \"name\" { … }`.",
            ));
        }
        let name = self.string("the task name")?;
        self.expect(Tok::LBrace, "an opening brace")?;

        let mut trigger = json!({ "type": "manual" });
        let mut description: Option<String> = None;
        let mut enabled = true;
        let mut perms = Map::new();
        let mut steps = Vec::new();

        loop {
            if self.peek().tok == Tok::RBrace || self.peek().tok == Tok::Eof {
                break;
            }
            if self.at_word("every")
                || self.at_word("once")
                || self.at_word("manual")
                || self.at_word("on")
            {
                trigger = self.trigger()?;
                continue;
            }
            if self.eat_word("describe") {
                description = Some(self.string("the description")?);
                continue;
            }
            if self.eat_word("disabled") {
                enabled = false;
                continue;
            }
            if self.eat_word("allow") {
                loop {
                    let tok = self.peek().clone();
                    let p = self.word("a permission")?;
                    match p.as_str() {
                        "command" | "script" | "deeplink" | "stopProcess" => { perms.insert(p, Value::Bool(true)); }
                        other => {
                            return Err(Diagnostic::at(
                                &tok,
                                format!("`{}` is not a permission. They are: command, script, deeplink, stopProcess.", other),
                            ))
                        }
                    }
                    if self.peek().tok == Tok::Comma {
                        self.next();
                        continue;
                    }
                    break;
                }
                continue;
            }
            steps.push(self.stmt()?);
        }
        self.expect(Tok::RBrace, "a closing brace")?;

        let mut o = json!({
            "name": name,
            "enabled": enabled,
            "trigger": trigger,
            "steps": steps,
            // The legacy flag stays FALSE and the split perms carry the truth. Writing it
            // true would grant `command` and `deeplink` to any task that asked for neither.
            "allowCustomCommands": false,
            "perms": Value::Object(perms),
        });
        if let Some(d) = description {
            o["description"] = Value::String(d);
        }
        Ok(o)
    }

    fn trigger(&mut self) -> PResult<Value> {
        if self.eat_word("manual") {
            return Ok(json!({ "type": "manual" }));
        }
        if self.eat_word("once") {
            if !self.eat_word("at") {
                let got = self.peek().clone();
                return Err(Diagnostic::at(
                    &got,
                    "Expected `at` and a date after `once`.",
                ));
            }
            let at = self.string("a date and time, like \"2026-01-01T09:00\"")?;
            return Ok(json!({ "type": "once", "at": at }));
        }
        if self.eat_word("on") {
            // `on app start`
            if self.eat_word("app") && self.eat_word("start") {
                return Ok(json!({ "type": "appStart" }));
            }
            // `on file "C:\\path\\to\\thing.log"`
            if self.eat_word("file") {
                let path = self.string("the path to watch")?;
                return Ok(json!({ "type": "watchFile", "path": path }));
            }
            // `on event "bmm.mod.missing"`
            if self.eat_word("event") {
                let event = self.string("the event name")?;
                return Ok(json!({ "type": "onEvent", "event": event }));
            }
            let got = self.peek().clone();
            return Err(Diagnostic::at(
                &got,
                "After `on`, expected `app start`, `file \"…\"` or `event \"…\"`.",
            ));
        }
        // every …
        self.next(); // 'every'
        if self.eat_word("day") {
            if !self.eat_word("at") {
                let got = self.peek().clone();
                return Err(Diagnostic::at(
                    &got,
                    "Expected `at` and a time, like `every day at 03:00`.",
                ));
            }
            let time = self.time()?;
            return Ok(json!({ "type": "dailyAt", "time": time }));
        }
        if self.eat_word("week") {
            if !self.eat_word("on") {
                let got = self.peek().clone();
                return Err(Diagnostic::at(
                    &got,
                    "Expected `on` and day names, like `every week on mon, fri at 09:00`.",
                ));
            }
            let mut days = Vec::new();
            loop {
                let tok = self.peek().clone();
                let d = self.word("a day name")?;
                match day_index(&d) {
                    Some(n) => days.push(Value::from(n)),
                    None => {
                        return Err(Diagnostic::at(
                            &tok,
                            format!("`{}` is not a day. Use mon tue wed thu fri sat sun.", d),
                        ))
                    }
                }
                if self.peek().tok == Tok::Comma {
                    self.next();
                    continue;
                }
                break;
            }
            if !self.eat_word("at") {
                let got = self.peek().clone();
                return Err(Diagnostic::at(&got, "Expected `at` and a time."));
            }
            let time = self.time()?;
            return Ok(json!({ "type": "weeklyAt", "time": time, "days": days }));
        }
        if self.eat_word("month") {
            if !self.eat_word("on") {
                let got = self.peek().clone();
                return Err(Diagnostic::at(
                    &got,
                    "Expected `on` and a day of the month.",
                ));
            }
            let day = match self.peek().tok.clone() {
                Tok::Num(n) => {
                    self.next();
                    n
                }
                _ => {
                    let got = self.peek().clone();
                    return Err(Diagnostic::at(
                        &got,
                        "Expected a day of the month, 1 to 31.",
                    ));
                }
            };
            if !self.eat_word("at") {
                let got = self.peek().clone();
                return Err(Diagnostic::at(&got, "Expected `at` and a time."));
            }
            let time = self.time()?;
            return Ok(json!({ "type": "monthlyAt", "day": num(day), "time": time }));
        }
        // every 30m / every 2h
        let tok = self.peek().clone();
        let secs = self.duration("an interval")?;
        if secs <= 0.0 {
            return Err(Diagnostic::at(
                &tok,
                "An interval has to be more than zero.",
            ));
        }
        // Hours when it divides evenly, because that is the trigger the editor shows and a
        // 120-minute interval displayed as minutes reads as a different schedule.
        if secs >= 3600.0 && (secs % 3600.0).abs() < f64::EPSILON {
            Ok(json!({ "type": "hourly", "everyHours": num(secs / 3600.0) }))
        } else {
            Ok(json!({ "type": "interval", "everyMinutes": num((secs / 60.0).max(1.0)) }))
        }
    }

    fn time(&mut self) -> PResult<String> {
        match self.peek().tok.clone() {
            Tok::Time(t) => {
                self.next();
                Ok(t)
            }
            Tok::Str(s) => {
                self.next();
                Ok(s)
            }
            _ => {
                let got = self.peek().clone();
                Err(Diagnostic::at(&got, "Expected a time like 03:00."))
            }
        }
    }
}

fn day_index(d: &str) -> Option<u8> {
    let d = d.to_lowercase();
    // Sunday is 0 — the runner's own convention, taken from Date.getDay(). Getting this
    // wrong shifts every weekly task by a day, silently.
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
        .iter()
        .position(|x| d.starts_with(x))
        .map(|i| i as u8)
}

/// Integers stay integers. `seconds: 30.0` in the JSON would round-trip through the editor
/// as "30" and back as 30.0 forever, and the diff on every save would be noise.
fn num(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        Value::from(n as i64)
    } else {
        Value::from(n)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CompileOut {
    pub ok: bool,
    /// The FIRST task, kept so every existing caller reads the field it always did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<Value>,
    /// Every task in the file. One file used to mean one task; a shared `.bmmscript` is far
    /// more useful when it can carry the automation AND the two it calls — which is what
    /// sharing one actually requires. The .bmmpa exporter follows sub-task references for
    /// exactly this reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<Value>>,
    pub errors: Vec<Diagnostic>,
}

fn compile_inner(source: &str, snippet: bool) -> CompileOut {
    let toks = match lex(source) {
        Ok(t) => t,
        Err(e) => {
            return CompileOut {
                ok: false,
                task: None,
                tasks: None,
                steps: None,
                errors: vec![e],
            }
        }
    };
    let mut p = P {
        toks,
        i: 0,
        src: source.chars().collect(),
    };

    if snippet {
        let mut steps = Vec::new();
        while p.peek().tok != Tok::Eof {
            match p.stmt() {
                Ok(s) => steps.push(s),
                Err(e) => {
                    return CompileOut {
                        ok: false,
                        task: None,
                        tasks: None,
                        steps: None,
                        errors: vec![e],
                    }
                }
            }
        }
        return CompileOut {
            ok: true,
            task: None,
            tasks: None,
            steps: Some(steps),
            errors: vec![],
        };
    }

    // Every task in the file, not just the first. Trailing text is still caught: anything
    // that is not the start of another task fails to parse as one, and a brace closed a line
    // early is what that looks like.
    let mut tasks: Vec<Value> = Vec::new();
    while p.peek().tok != Tok::Eof {
        // Trailing junk after a task that parsed keeps its OWN message. Falling through to
        // "a file starts with task" would be true and useless: the file plainly does start
        // with one, and the real cause is almost always a brace closed a line too early.
        if !tasks.is_empty() && !p.at_word("task") {
            let got = p.peek().clone();
            return CompileOut {
                ok: false,
                task: None,
                tasks: None,
                steps: None,
                errors: vec![Diagnostic::at(
                    &got,
                    "There is more text after the task ended \u{2014} check for a `}` that closes too early.",
                )],
            };
        }
        match p.task() {
            Ok(t) => tasks.push(t),
            Err(e) => {
                return CompileOut {
                    ok: false,
                    task: None,
                    tasks: None,
                    steps: None,
                    errors: vec![e],
                }
            }
        }
    }
    if tasks.is_empty() {
        let got = p.peek().clone();
        return CompileOut {
            ok: false,
            task: None,
            tasks: None,
            steps: None,
            errors: vec![Diagnostic::at(&got, "This file has no task in it.")],
        };
    }
    CompileOut {
        ok: true,
        task: Some(tasks[0].clone()),
        tasks: Some(tasks),
        steps: None,
        errors: vec![],
    }
}

/// Parse a whole `task "…" { … }` into the brick tree.
#[tauri::command]
pub fn bmms_compile(source: String) -> CompileOut {
    compile_inner(&source, false)
}

/// Parse bare statements — the body of a `code.run` step, with no task wrapper.
#[tauri::command]
pub fn bmms_compile_steps(source: String) -> CompileOut {
    compile_inner(&source, true)
}

// ─────────────────────────────────────────────────────────────────────────────
// The other direction
// ─────────────────────────────────────────────────────────────────────────────

fn ind(n: usize) -> String {
    "    ".repeat(n)
}

fn quote(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn val(v: &Value) -> String {
    match v {
        Value::String(s) => quote(s),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        // An array or object param has no surface syntax — `list.set` holds one. Written as
        // compact JSON inside a string so it survives the round trip rather than being lost.
        other => quote(&other.to_string()),
    }
}

fn args_str(params: &Value) -> String {
    let Some(o) = params.as_object() else {
        return String::new();
    };
    if o.is_empty() {
        return String::new();
    }
    // Sorted, so the same tree always prints the same text. A map's iteration order is not
    // a promise, and an unstable printer makes every save look like an edit.
    let mut keys: Vec<&String> = o.keys().collect();
    keys.sort();
    let inner: Vec<String> = keys
        .iter()
        .map(|k| format!("{}: {}", k, val(&o[*k])))
        .collect();
    inner.join(", ")
}

fn cond_str(c: &Value) -> String {
    let ty = c.get("type").and_then(|x| x.as_str()).unwrap_or("always");
    let neg = c.get("negate") == Some(&Value::Bool(true));
    let params = c.get("params").cloned().unwrap_or_else(|| json!({}));

    let body = if (ty == "all" || ty == "any") && params.get("conditions").is_some() {
        let joiner = if ty == "all" { " and " } else { " or " };
        let parts: Vec<String> = params["conditions"]
            .as_array()
            .map(|a| a.iter().map(cond_str).collect())
            .unwrap_or_default();
        if parts.is_empty() {
            "always".to_string()
        } else if parts.len() == 1 {
            parts[0].clone()
        } else {
            format!("({})", parts.join(joiner))
        }
    } else if ty == "value"
        && params
            .get("source")
            .and_then(|x| x.as_str())
            .is_some_and(|s| !s.is_empty())
    {
        // `count > 3`, not `value(op: ">", source: "count", value: 3)`.
        let src = params["source"].as_str().unwrap_or("");
        let op = params.get("op").and_then(|x| x.as_str()).unwrap_or("==");
        let v = params.get("value").cloned().unwrap_or(Value::Null);
        // A number stays bare; anything else is quoted, so it reads back as the same thing.
        let rhs = match &v {
            Value::Number(n) => n.to_string(),
            Value::String(t) if t.parse::<f64>().is_ok() => quote(t),
            other => val(other),
        };
        format!("{} {} {}", src, op, rhs)
    } else {
        let a = args_str(&params);
        if a.is_empty() {
            ty.to_string()
        } else {
            format!("{}({})", ty, a)
        }
    };
    if neg {
        format!("not {}", body)
    } else {
        body
    }
}

fn dur_str(secs: f64) -> String {
    if secs > 0.0 && secs % 3600.0 == 0.0 {
        format!("{}h", (secs / 3600.0) as i64)
    } else if secs > 0.0 && secs % 60.0 == 0.0 {
        format!("{}m", (secs / 60.0) as i64)
    } else if secs.fract() == 0.0 {
        format!("{}s", secs as i64)
    } else {
        format!("{}s", secs)
    }
}

fn steps_str(steps: &[Value], depth: usize, out: &mut String) {
    for st in steps {
        let kind = st.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let pad = ind(depth);
        match kind {
            "action" => {
                let a = st.get("action").cloned().unwrap_or_else(|| json!({}));
                let ty = a.get("type").and_then(|x| x.as_str()).unwrap_or("");
                // The three actions with surface syntax print as that syntax. A `set` that
                // came back as `do math.set(expr: "n + 1", target: "n")` would still be
                // correct and would still make the round trip a downgrade every time.
                let pr = a.get("params").cloned().unwrap_or_else(|| json!({}));
                let ps = |k: &str| pr.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
                if ty == "math.set" && !ps("target").is_empty() {
                    out.push_str(&format!(
                        "{}set {} = {}
",
                        pad,
                        ps("target"),
                        ps("expr")
                    ));
                    continue;
                }
                if ty == "log.print" {
                    out.push_str(&format!("{}print {}\n", pad, quote(&ps("text"))));
                    continue;
                }
                if ty == "var.set" && !ps("name").is_empty() {
                    let sh = if ps("scope") == "shared" {
                        "shared "
                    } else {
                        ""
                    };
                    out.push_str(&format!(
                        "{}{}set {} = {}
",
                        pad,
                        sh,
                        ps("name"),
                        quote(&ps("value"))
                    ));
                    continue;
                }
                // The two task actions print as their own words.
                if (ty == "task.run" || ty == "task.spawn") && !ps("id").is_empty() {
                    let verb = if ty == "task.run" { "run" } else { "spawn" };
                    out.push_str(&format!(
                        "{}{} {}
",
                        pad,
                        verb,
                        quote(&ps("id"))
                    ));
                    continue;
                }
                // A script prints as a BLOCK, body as written. Printing it as an action would
                // mean escaping every quote and newline in somebody else's language, and the
                // round trip would turn a readable script into one line of backslashes.
                if ty == "custom.script" && !ps("code").is_empty() {
                    let eng = if ps("engine").is_empty() {
                        "powershell".to_string()
                    } else {
                        ps("engine")
                    };
                    out.push_str(&format!(
                        "{}script {} {{
",
                        pad, eng
                    ));
                    for line in ps("code").lines() {
                        out.push_str(&format!(
                            "{}{}
",
                            ind(depth + 1),
                            line
                        ));
                    }
                    out.push_str(&format!(
                        "{}}}
",
                        pad
                    ));
                    continue;
                }
                if ty == "var.clear" && !ps("name").is_empty() {
                    out.push_str(&format!(
                        "{}clear {}
",
                        pad,
                        ps("name")
                    ));
                    continue;
                }
                out.push_str(&format!(
                    "{}do {}({})\n",
                    pad,
                    ty,
                    args_str(a.get("params").unwrap_or(&json!({})))
                ));
            }
            "delay" => {
                let s = st.get("seconds").and_then(|x| x.as_f64()).unwrap_or(0.0);
                out.push_str(&format!("{}wait {}\n", pad, dur_str(s)));
            }
            "if" => {
                out.push_str(&format!(
                    "{}if {} {{\n",
                    pad,
                    cond_str(st.get("condition").unwrap_or(&json!({})))
                ));
                steps_str(
                    st.get("then")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                let els = st
                    .get("else")
                    .and_then(|x| x.as_array())
                    .map(|v| &v[..])
                    .unwrap_or(&[]);
                if els.is_empty() {
                    out.push_str(&format!("{}}}\n", pad));
                } else {
                    out.push_str(&format!("{}}} else {{\n", pad));
                    steps_str(els, depth + 1, out);
                    out.push_str(&format!("{}}}\n", pad));
                }
            }
            "forEach" => {
                let src = st.get("source").and_then(|x| x.as_str()).unwrap_or("mods");
                let ln = st.get("listName").and_then(|x| x.as_str());
                let head = match ln {
                    Some(n) => format!("for item in {} {}", src, quote(n)),
                    None => format!("for item in {}", src),
                };
                out.push_str(&format!("{}{} {{\n", pad, head));
                steps_str(
                    st.get("steps")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                out.push_str(&format!("{}}}\n", pad));
            }
            "repeat" => {
                let mode = st.get("mode").and_then(|x| x.as_str()).unwrap_or("times");
                let head = if mode == "times" {
                    format!(
                        "repeat {} times",
                        st.get("times").and_then(|x| x.as_f64()).unwrap_or(1.0) as i64
                    )
                } else if mode == "doWhile" {
                    // No surface syntax for do-while; printed as `while` with the truth in a
                    // comment rather than silently becoming a different loop.
                    format!(
                        "repeat while {}   // was: do-while (runs once before the check)",
                        cond_str(st.get("condition").unwrap_or(&json!({})))
                    )
                } else {
                    format!(
                        "repeat {} {}",
                        mode,
                        cond_str(st.get("condition").unwrap_or(&json!({})))
                    )
                };
                out.push_str(&format!("{}{} {{\n", pad, head));
                steps_str(
                    st.get("steps")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                out.push_str(&format!("{}}}\n", pad));
            }
            "waitFor" => {
                let mut line = format!(
                    "{}waitfor {}",
                    pad,
                    cond_str(st.get("condition").unwrap_or(&json!({})))
                );
                if let Some(t) = st.get("timeoutSec").and_then(|x| x.as_f64()) {
                    line.push_str(&format!(" timeout {}", dur_str(t)));
                }
                if let Some(t) = st.get("pollSec").and_then(|x| x.as_f64()) {
                    line.push_str(&format!(" poll {}", dur_str(t)));
                }
                if st.get("onTimeout").and_then(|x| x.as_str()) == Some("continue") {
                    line.push_str(" orcontinue");
                }
                out.push_str(&line);
                out.push('\n');
            }
            "retry" => {
                let times = st.get("times").and_then(|x| x.as_i64()).unwrap_or(3);
                let every = st.get("everySec").and_then(|x| x.as_f64()).unwrap_or(5.0);
                out.push_str(&format!("{}retry {} times every {}s {{\n", pad, times, every as i64));
                steps_str(
                    st.get("steps")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                out.push_str(&format!("{}}}", pad));
                if st.get("onFail").and_then(|x| x.as_str()) == Some("continue") {
                    out.push_str(" orcontinue");
                }
                out.push('\n');
            }
            "ensure" => {
                out.push_str(&format!(
                    "{}ensure {} {{\n",
                    pad,
                    cond_str(st.get("condition").unwrap_or(&Value::Null))
                ));
                steps_str(
                    st.get("steps")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                out.push_str(&format!("{}}}", pad));
                if st.get("onFail").and_then(|x| x.as_str()) == Some("continue") {
                    out.push_str(" orcontinue");
                }
                out.push('\n');
            }
            "try" => {
                out.push_str(&format!("{}try {{\n", pad));
                steps_str(
                    st.get("steps")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                out.push_str(&format!("{}}} catch {{\n", pad));
                steps_str(
                    st.get("onError")
                        .and_then(|x| x.as_array())
                        .map(|v| &v[..])
                        .unwrap_or(&[]),
                    depth + 1,
                    out,
                );
                out.push_str(&format!("{}}}\n", pad));
            }
            "switch" => {
                out.push_str(&format!("{}switch {{\n", pad));
                if let Some(cases) = st.get("cases").and_then(|x| x.as_array()) {
                    for c in cases {
                        out.push_str(&format!(
                            "{}case {} {{\n",
                            ind(depth + 1),
                            cond_str(c.get("condition").unwrap_or(&json!({})))
                        ));
                        steps_str(
                            c.get("steps")
                                .and_then(|x| x.as_array())
                                .map(|v| &v[..])
                                .unwrap_or(&[]),
                            depth + 2,
                            out,
                        );
                        out.push_str(&format!("{}}}\n", ind(depth + 1)));
                    }
                }
                let d = st
                    .get("default")
                    .and_then(|x| x.as_array())
                    .map(|v| &v[..])
                    .unwrap_or(&[]);
                if !d.is_empty() {
                    out.push_str(&format!("{}default {{\n", ind(depth + 1)));
                    steps_str(d, depth + 2, out);
                    out.push_str(&format!("{}}}\n", ind(depth + 1)));
                }
                out.push_str(&format!("{}}}\n", pad));
            }
            "parallel" => {
                let settle = st.get("mode").and_then(|x| x.as_str()) == Some("settle");
                out.push_str(&format!(
                    "{}parallel{} {{
",
                    pad,
                    if settle { " settle" } else { "" }
                ));
                for b in st
                    .get("branches")
                    .and_then(|x| x.as_array())
                    .cloned()
                    .unwrap_or_default()
                {
                    out.push_str(&format!(
                        "{}branch {{
",
                        ind(depth + 1)
                    ));
                    steps_str(b.as_array().map(|v| &v[..]).unwrap_or(&[]), depth + 2, out);
                    out.push_str(&format!(
                        "{}}}
",
                        ind(depth + 1)
                    ));
                }
                out.push_str(&format!(
                    "{}}}
",
                    pad
                ));
            }
            "call" => out.push_str(&format!(
                "{}call {}\n",
                pad,
                quote(st.get("block").and_then(|x| x.as_str()).unwrap_or(""))
            )),
            "break" | "continue" | "stop" => out.push_str(&format!("{}{}\n", pad, kind)),
            other => out.push_str(&format!(
                "{}// unknown step kind `{}` — left as a comment so it is not lost\n",
                pad, other
            )),
        }
    }
}

fn trigger_str(tr: &Value) -> String {
    let ty = tr.get("type").and_then(|x| x.as_str()).unwrap_or("manual");
    let s = |k: &str| tr.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let n = |k: &str| tr.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
    match ty {
        "dailyAt" => format!("every day at {}", s("time")),
        "weeklyAt" => {
            let names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
            let days: Vec<String> = tr
                .get("days")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|d| d.as_u64())
                        .filter_map(|d| names.get(d as usize))
                        .map(|x| x.to_string())
                        .collect()
                })
                .unwrap_or_default();
            format!("every week on {} at {}", days.join(", "), s("time"))
        }
        "monthlyAt" => format!("every month on {} at {}", n("day") as i64, s("time")),
        "hourly" => format!("every {}h", n("everyHours") as i64),
        "interval" => format!("every {}m", n("everyMinutes") as i64),
        "once" => format!("once at {}", quote(&s("at"))),
        "appStart" => "on app start".to_string(),
        // These two were printing as `manual`, which is not a wrong word — it is a task that
        // stops firing. A watch or an event task written in the editor, opened in code and
        // saved back came out DISARMED, with nothing to notice: `manual` is a legitimate
        // trigger, so nothing errored and nothing looked wrong.
        "watchFile" => format!("on file {}", quote(&s("path"))),
        "onEvent" => format!("on event {}", quote(&s("event"))),
        _ => "manual".to_string(),
    }
}

/// Print a task as BMMScript. The inverse of `bmms_compile`, and tested as such.
#[tauri::command]
pub fn bmms_decompile(task: Value) -> String {
    let name = task
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("Untitled");
    let mut out = format!("task {} {{\n", quote(name));
    out.push_str(&format!(
        "{}{}\n",
        ind(1),
        trigger_str(task.get("trigger").unwrap_or(&json!({})))
    ));

    if let Some(d) = task
        .get("description")
        .and_then(|x| x.as_str())
        .filter(|d| !d.trim().is_empty())
    {
        out.push_str(&format!("{}describe {}\n", ind(1), quote(d)));
    }
    if task.get("enabled") == Some(&Value::Bool(false)) {
        out.push_str(&format!("{}disabled\n", ind(1)));
    }

    // Both sources, because an old task carries only the legacy flag and printing just
    // `perms` would silently drop permissions it really has.
    let mut granted: Vec<&str> = Vec::new();
    if let Some(p) = task.get("perms").and_then(|x| x.as_object()) {
        for k in ["command", "script", "deeplink", "stopProcess"] {
            if p.get(k) == Some(&Value::Bool(true)) {
                granted.push(k);
            }
        }
    }
    if task.get("allowCustomCommands") == Some(&Value::Bool(true)) {
        for k in ["command", "deeplink"] {
            if !granted.contains(&k) {
                granted.push(k);
            }
        }
    }
    if !granted.is_empty() {
        out.push_str(&format!("{}allow {}\n", ind(1), granted.join(", ")));
    }

    out.push('\n');
    let steps = task
        .get("steps")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    steps_str(&steps, 1, &mut out);
    out.push_str("}\n");
    out
}

// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    fn compile(src: &str) -> Value {
        let r = compile_inner(src, false);
        assert!(r.ok, "should compile: {:?}", r.errors);
        r.task.unwrap()
    }

    #[test]
    fn a_whole_task_lowers_to_the_brick_tree() {
        let t = compile(
            r#"task "Nightly" {
                every day at 03:00
                allow script
                do mods.scan()
                do notify(message: "done", level: info)
            }"#,
        );
        assert_eq!(t["name"], "Nightly");
        assert_eq!(t["trigger"]["type"], "dailyAt");
        assert_eq!(t["trigger"]["time"], "03:00");
        assert_eq!(t["perms"]["script"], true);
        // The legacy flag must stay false: writing it true grants command AND deeplink to a
        // task that asked for neither.
        assert_eq!(t["allowCustomCommands"], false);
        assert_eq!(t["steps"][0]["action"]["type"], "mods.scan");
        assert_eq!(t["steps"][1]["action"]["params"]["message"], "done");
        assert_eq!(t["steps"][1]["action"]["params"]["level"], "info");
    }

    #[test]
    fn any_action_name_works_without_the_language_knowing_it() {
        // The property the whole design rests on: an action invented tomorrow is already
        // writable, because nothing here holds a list of actions.
        let t = compile(r#"task "T" { do some.action.invented.later(a: 1) }"#);
        assert_eq!(
            t["steps"][0]["action"]["type"],
            "some.action.invented.later"
        );
        assert_eq!(t["steps"][0]["action"]["params"]["a"], 1);
    }

    #[test]
    fn and_or_lower_to_all_any_and_flatten() {
        let t = compile(r#"task "T" { if online and modEnabled(id: "x") and always { stop } }"#);
        let c = &t["steps"][0]["condition"];
        assert_eq!(c["type"], "all");
        assert_eq!(
            c["params"]["conditions"].as_array().unwrap().len(),
            3,
            "a and b and c is one all of three"
        );
    }

    #[test]
    fn not_sets_negate_and_double_not_clears_it() {
        let t = compile(r#"task "T" { if not online { stop } }"#);
        assert_eq!(t["steps"][0]["condition"]["negate"], true);
        let t2 = compile(r#"task "T" { if not (not online) { stop } }"#);
        assert_eq!(
            t2["steps"][0]["condition"].get("negate"),
            Some(&Value::Bool(false))
        );
    }

    #[test]
    fn every_step_kind_survives() {
        let t = compile(
            r#"task "T" {
                manual
                wait 5m
                waitfor fileExists(path: "x") timeout 2h poll 10s orcontinue
                for mod in enabledMods { do mod.disable() break }
                repeat 3 times { continue }
                repeat while online { stop }
                try { do a() } catch { do b() }
                switch { case online { do c() } default { do d() } }
                call "shared"
            }"#,
        );
        let kinds: Vec<&str> = t["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            vec!["delay", "waitFor", "forEach", "repeat", "repeat", "try", "switch", "call"]
        );
        assert_eq!(t["steps"][0]["seconds"], 300);
        assert_eq!(t["steps"][1]["timeoutSec"], 7200);
        assert_eq!(t["steps"][1]["onTimeout"], "continue");
        assert_eq!(t["steps"][2]["source"], "enabledMods");
        assert_eq!(t["steps"][3]["times"], 3);
    }

    #[test]
    fn triggers_map_to_what_the_editor_shows() {
        assert_eq!(
            compile(r#"task "T" { every 30m }"#)["trigger"]["everyMinutes"],
            30
        );
        // Two hours is an HOURLY trigger, not a 120-minute one: shown as minutes it reads
        // as a different schedule from the one that was written.
        assert_eq!(
            compile(r#"task "T" { every 2h }"#)["trigger"]["type"],
            "hourly"
        );
        assert_eq!(
            compile(r#"task "T" { every 2h }"#)["trigger"]["everyHours"],
            2
        );
        let w = compile(r#"task "T" { every week on mon, fri at 09:30 }"#);
        assert_eq!(
            w["trigger"]["days"],
            json!([1, 5]),
            "Sunday is 0 — the runner's own convention"
        );
        assert_eq!(w["trigger"]["time"], "09:30");
        assert_eq!(
            compile(r#"task "T" { on app start }"#)["trigger"]["type"],
            "appStart"
        );
        assert_eq!(
            compile(r#"task "T" { every month on 1 at 00:00 }"#)["trigger"]["day"],
            1
        );
    }

    /// EVERY trigger has to survive a round trip, or opening a task in code disarms it.
    ///
    /// `watchFile` and `onEvent` were printing as `manual`. That is not a wrong word, it is a
    /// task that stops firing — and nothing notices, because `manual` is a legitimate
    /// trigger, so nothing errors and nothing on screen looks wrong.
    ///
    /// Written as a loop over every type rather than as one case each: the next trigger
    /// somebody adds fails HERE, instead of silently becoming manual in the field.
    #[test]
    fn every_trigger_survives_being_printed_and_read_back() {
        let cases: &[(&str, serde_json::Value)] = &[
            ("manual", json!({ "type": "manual" })),
            ("appStart", json!({ "type": "appStart" })),
            ("interval", json!({ "type": "interval", "everyMinutes": 30 })),
            ("hourly", json!({ "type": "hourly", "everyHours": 2 })),
            ("dailyAt", json!({ "type": "dailyAt", "time": "03:00" })),
            ("weeklyAt", json!({ "type": "weeklyAt", "time": "08:00", "days": [1] })),
            ("monthlyAt", json!({ "type": "monthlyAt", "day": 1, "time": "00:00" })),
            ("once", json!({ "type": "once", "at": "2026-01-01T09:00" })),
            ("watchFile", json!({ "type": "watchFile", "path": "C:/games/dcs.log" })),
            ("onEvent", json!({ "type": "onEvent", "event": "bmm.mod.missing" })),
        ];
        for (name, trigger) in cases {
            let task = json!({ "name": "T", "trigger": trigger, "steps": [] });
            let printed = bmms_decompile(task);
            let back = compile(&printed);
            assert_eq!(
                back["trigger"]["type"], trigger["type"],
                "{} printed as `{}` and came back as {}",
                name, printed.trim(), back["trigger"]["type"]
            );
            // The type alone is not enough: `on file` with no path is still a watchFile, and
            // still a task that watches nothing.
            for key in ["path", "event", "time", "at", "everyMinutes", "everyHours", "day"] {
                if let Some(want) = trigger.get(key) {
                    assert_eq!(&back["trigger"][key], want, "{} lost its {}", name, key);
                }
            }
        }
    }

    /// `print` is sugar, and sugar has to survive the printer or the editor eats it.
    #[test]
    fn print_lowers_to_an_action_and_prints_back_as_print() {
        let src = "task \"P\" {
    every day at 03:00

    print \"got {n} mods\"
}
";
        let first = compile(src);
        let st = &first["steps"][0];
        // It IS an action. Nothing new to run, nothing new to permission — the same reason
        // `set` lowers to var.set.
        assert_eq!(st["kind"], "action");
        assert_eq!(st["action"]["type"], "log.print");
        assert_eq!(st["action"]["params"]["text"], "got {n} mods");

        // And it comes back as `print`, not as `do log.print(...)`. Without the printer rule
        // a task written in code and reopened would read as somebody else's task.
        let printed = bmms_decompile(first.clone());
        assert!(printed.contains("print \"got {n} mods\""), "printed: {}", printed);
        assert!(!printed.contains("do log.print"), "printed: {}", printed);
        assert_eq!(compile(&printed), first);
    }

    /// `retry` keeps its count and its gap through a round trip.
    ///
    /// Both are easy to lose and neither fails loudly: a retry that comes back as `retry 1
    /// times` is a step that has quietly stopped retrying, and one that loses its gap hammers
    /// whatever it is retrying against as fast as it can.
    #[test]
    fn retry_keeps_its_count_and_its_gap() {
        let src = "task \"R\" {
    every day at 03:00

    retry 4 times every 30s {
        do repo.syncNow()
    }
}
";
        let first = compile(src);
        let st = &first["steps"][0];
        assert_eq!(st["kind"], "retry");
        assert_eq!(st["times"], 4);
        assert_eq!(st["everySec"], 30.0);
        assert_eq!(st["onFail"], "abort");

        let printed = bmms_decompile(first.clone());
        assert!(printed.contains("retry 4 times every 30s"), "printed: {}", printed);
        assert_eq!(compile(&printed), first, "printed: {}", printed);
    }

    /// A gap is optional, and leaving it out must not mean zero.
    #[test]
    fn retry_without_a_gap_still_waits() {
        // `retry 3 times { … }` with no `every` would otherwise re-run instantly three
        // times, which for a network failure is three failures in the same millisecond.
        let first = compile("task \"R\" {
    manual

    retry 3 times {
        do mods.scan()
    }
}
");
        assert_eq!(first["steps"][0]["times"], 3);
        assert!(first["steps"][0]["everySec"].as_f64().unwrap() > 0.0);
    }

    /// `ensure` is not sugar for `if not`, and the tree has to show that.
    #[test]
    fn ensure_compiles_to_its_own_step_and_prints_back() {
        let src = "task \"State\" {
    every day at 03:00

    ensure modEnabled(id: \"big\") {
        do mod.enable(id: \"big\")
    }
    ensure online {
        do notify(message: \"offline\")
    } orcontinue
}
";
        let first = compile(src);
        let steps = first["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0]["kind"], "ensure");
        // The condition is kept as written. An `ensure` that stored `not <cond>` would run
        // its block when the state is FINE, which is the exact inversion this must not have.
        assert_eq!(steps[0]["condition"]["type"], "modEnabled");
        assert_eq!(steps[0]["onFail"], "abort");
        assert_eq!(steps[0]["steps"].as_array().unwrap().len(), 1);
        assert_eq!(steps[1]["onFail"], "continue");

        // And it survives the printer, `orcontinue` included.
        let printed = bmms_decompile(first.clone());
        assert!(printed.contains("ensure modEnabled"), "printed: {}", printed);
        assert!(printed.contains("} orcontinue"), "printed: {}", printed);
        assert_eq!(compile(&printed), first, "printed: {}", printed);
    }

    #[test]
    fn round_trip_is_stable() {
        let src = r#"task "Nightly" {
    every day at 03:00
    allow script, command

    do mods.scan()
    if online and not modEnabled(id: "big") {
        do notify(message: "scanning")
        wait 30s
    } else {
        stop
    }
    for item in enabledMods {
        try {
            do mod.disable(id: "{item.id}")
        } catch {
            do notify(message: "failed")
        }
    }
}
"#;
        let first = compile(src);
        let printed = bmms_decompile(first.clone());
        let second = compile(&printed);
        assert_eq!(
            first, second,
            "source -> tree -> source -> tree must be identical\n--- printed ---\n{}",
            printed
        );
    }

    #[test]
    fn a_task_built_from_BRICKS_round_trips_through_code() {
        // The direction that matters for the promise "open it in either mode": this starts
        // from the tree the EDITOR produces, not from hand-written source. A printer that
        // is merely pretty would pass the source-first test and lose a field here.
        let brick_task = json!({
            "id": "sched-1",
            "name": "Weekly tidy",
            "description": "what it says",
            "enabled": true,
            "trigger": { "type": "weeklyAt", "time": "04:15", "days": [1, 3, 5] },
            "allowCustomCommands": false,
            "perms": { "script": true, "stopProcess": true },
            "steps": [
                { "kind": "action", "action": { "type": "mods.scan", "params": {} } },
                { "kind": "switch", "cases": [
                    { "condition": { "type": "online", "params": {} },
                      "steps": [ { "kind": "action", "action": { "type": "notify", "params": { "message": "up" } } } ] }
                  ], "default": [ { "kind": "stop" } ] },
                { "kind": "waitFor", "condition": { "type": "fileExists", "params": { "path": r"C:\x\y.txt" }, "negate": true },
                  "timeoutSec": 90, "pollSec": 5, "onTimeout": "continue" },
                { "kind": "forEach", "source": "list", "listName": "queue", "maxIters": 500, "everySec": 0, "steps": [
                    { "kind": "try",
                      "steps": [ { "kind": "action", "action": { "type": "mod.enable", "params": { "id": "{item.id}" } } } ],
                      "onError": [ { "kind": "continue" } ] }
                ] },
                { "kind": "repeat", "mode": "until", "condition": { "type": "all", "params": { "conditions": [
                    { "type": "online", "params": {} },
                    { "type": "appRunning", "params": { "name": "game.exe" } }
                ] } }, "maxIters": 500, "everySec": 0, "steps": [ { "kind": "delay", "seconds": 120 } ] }
            ]
        });

        let printed = bmms_decompile(brick_task.clone());
        let back = compile(&printed);

        // Field by field, because a whole-object compare would also demand `id`, which the
        // language does not carry (it is assigned by the store, not by the author).
        for k in [
            "name",
            "description",
            "enabled",
            "trigger",
            "perms",
            "allowCustomCommands",
            "steps",
        ] {
            assert_eq!(
                &back[k], &brick_task[k],
                "`{}` changed going through code
--- printed ---
{}",
                k, printed
            );
        }
    }

    #[test]
    fn every_example_in_the_documentation_compiles() {
        // Lifted verbatim from BMM Docs/docs/features/bmmscript{,.fr}.md, so prose cannot
        // drift from the language. NOTHING ELSE may be written between this function and
        // a_windows_path_keeps_its_backslashes: the regeneration replaces that whole span,
        // and it has silently eaten fifteen tests doing exactly that.
        let cases: &[(&str, &str)] = &[
            (
                "bmmscript.md 1",
                r#"task "Nightly tidy" {
    every day at 03:00
    describe "Scan, then disable anything huge"
    allow script

    do mods.scan()

    if online and not modEnabled(id: "keep-me") {
        do notify(message: "Scanning…")
        wait 30s
    } else {
        stop
    }

    for item in enabledMods {
        try {
            do mod.disable(id: "{item.id}")
        } catch {
            do notify(message: "Could not disable {item.name}")
        }
    }
}
"#,
            ),
            (
                "bmmscript.md ensure",
                r#"ensure modEnabled(id: "big-map-pack") {
    do mod.enable(id: "big-map-pack")
}

ensure fileExists(path: "{game}/config/ready.txt") {
    do script.run(engine: "powershell", code: "New-Item ...")
} orcontinue
"#,
            ),
            (
                "bmmscript.md 2",
                r#"do mods.scan()
do notify(message: "done", level: info)
do mod.disable(id: "{item.id}")
"#,
            ),
            (
                "bmmscript.md 3",
                r#"if online { do mods.scan() }
if not fileExists(path: "C:\mods\out.txt") { do mods.scan() } else { stop }
if online and modEnabled(id: "x") { do mods.scan() } else if always { stop }
"#,
            ),
            (
                "bmmscript.md 4",
                r#"set count = 0
set count = count + 1
set average = (a + b) / 2
set label = "hello"
shared set team = "red"
clear count
"#,
            ),
            (
                "bmmscript.md 5",
                r#"if count >= 3 { stop }
if disk.write_mbps < 50 { do notify(message: "slow disk") }
"#,
            ),
            (
                "bmmscript.md 6",
                r#"for item in enabledMods { do mod.disable(id: "{item.id}") }   # mods, enabledMods, disabledMods, profiles, modpacks, themes
for item in list "queue" { do notify(message: "{item.name}") } # a list you built with list.push
repeat 3 times { do mods.scan() }
repeat while online { wait 1m }
repeat until fileExists(path: "x") { wait 10s }
"#,
            ),
            (
                "bmmscript.md 7",
                r#"parallel {
    branch { do repo.sync() }
    branch { do benchmark.run() }
}

parallel settle {
    branch { do mods.checkUpdates() }
    branch { do mods.scan() }
}
"#,
            ),
            (
                "bmmscript.md 8",
                r#"run "Nightly tidy"       # waits for it, and records whether it worked
spawn "Long download"    # starts it and carries on
"#,
            ),
            (
                "bmmscript.md 9",
                r#"script python {
    import os
    print(os.getcwd())
}

script bash {
    for f in *.zip; do echo "$f"; done
}
"#,
            ),
            (
                "bmmscript.md 10",
                r#"set count: number = 0
set label: text = "hello"
"#,
            ),
            (
                "bmmscript.md 11",
                r#"wait 30s                                    # also 5m, 2h, or a bare number of seconds
waitfor fileExists(path: "x") timeout 2h poll 10s
waitfor online timeout 30s orcontinue       # carry on instead of failing
"#,
            ),
            (
                "bmmscript.md 12",
                r#"try {
    do repo.sync()
} catch {
    do notify(message: "sync failed")
}

switch {
    case online { do repo.sync() }
    case fileExists(path: "cache.json") { do modlist.import() }
    default { do notify(message: "nothing to do") }
}
"#,
            ),
            (
                "bmmscript.md 13",
                r#"call "my shared block"
"#,
            ),
            (
                "bmmscript.md 14",
                r#"do mods.scan()
if online {
    do notify(message: "hello")
}
"#,
            ),
            (
                "bmmscript.fr.md 1",
                r#"task "Ménage nocturne" {
    every day at 03:00
    describe "Scanner, puis désactiver ce qui est énorme"
    allow script

    do mods.scan()

    if online and not modEnabled(id: "garde-moi") {
        do notify(message: "Analyse…")
        wait 30s
    } else {
        stop
    }

    for item in enabledMods {
        try {
            do mod.disable(id: "{item.id}")
        } catch {
            do notify(message: "Impossible de désactiver {item.name}")
        }
    }
}
"#,
            ),
            (
                "bmmscript.fr.md 2",
                r#"do mods.scan()
do notify(message: "terminé", level: info)
do mod.disable(id: "{item.id}")
"#,
            ),
            (
                "bmmscript.fr.md 3",
                r#"if online { do mods.scan() }
if not fileExists(path: "C:\mods\sortie.txt") { do mods.scan() } else { stop }
if online and modEnabled(id: "x") { do mods.scan() } else if always { stop }
"#,
            ),
            (
                "bmmscript.fr.md 4",
                r#"set count = 0
set count = count + 1
set moyenne = (a + b) / 2
set label = "bonjour"
shared set equipe = "rouge"
clear count
"#,
            ),
            (
                "bmmscript.fr.md 5",
                r#"if count >= 3 { stop }
if disk.write_mbps < 50 { do notify(message: "disque lent") }
"#,
            ),
            (
                "bmmscript.fr.md 6",
                r#"for item in enabledMods { do mod.disable(id: "{item.id}") }   # mods, enabledMods, disabledMods, profiles, modpacks, themes
for item in list "file" { do notify(message: "{item.name}") }  # une liste construite avec list.push
repeat 3 times { do mods.scan() }
repeat while online { wait 1m }
repeat until fileExists(path: "x") { wait 10s }
"#,
            ),
            (
                "bmmscript.fr.md 7",
                r#"parallel {
    branch { do repo.sync() }
    branch { do benchmark.run() }
}

parallel settle {
    branch { do mods.checkUpdates() }
    branch { do mods.scan() }
}
"#,
            ),
            (
                "bmmscript.fr.md 8",
                r#"run "Ménage nocturne"    # attend, et note si ça a marché
spawn "Long téléchargement"  # démarre et continue
"#,
            ),
            (
                "bmmscript.fr.md 9",
                r#"script python {
    import os
    print(os.getcwd())
}

script bash {
    for f in *.zip; do echo "$f"; done
}
"#,
            ),
            (
                "bmmscript.fr.md 10",
                r#"set count: number = 0
set label: text = "bonjour"
"#,
            ),
            (
                "bmmscript.fr.md 11",
                r#"wait 30s                                    # aussi 5m, 2h, ou un nombre nu de secondes
waitfor fileExists(path: "x") timeout 2h poll 10s
waitfor online timeout 30s orcontinue       # continuer au lieu d'échouer
"#,
            ),
            (
                "bmmscript.fr.md 12",
                r#"try {
    do repo.sync()
} catch {
    do notify(message: "échec de la synchro")
}

switch {
    case online { do repo.sync() }
    case fileExists(path: "cache.json") { do modlist.import() }
    default { do notify(message: "rien à faire") }
}
"#,
            ),
            (
                "bmmscript.fr.md 13",
                r#"do mods.scan()
if online {
    do notify(message: "bonjour")
}
"#,
            ),
        ];
        for (label, src) in cases {
            let whole = compile_inner(src, false);
            let snippet = compile_inner(src, true);
            assert!(
                whole.ok || snippet.ok,
                "{} does not compile: {:?}",
                label,
                if whole.ok {
                    &snippet.errors
                } else {
                    &whole.errors
                }
            );
        }
    }

    #[test]
    fn a_windows_path_keeps_its_backslashes() {
        // The most common string in this language, and the one a naive escape handler eats.
        let t = compile(r#"task "T" { do folder.open(path: "C:\mods\Skyrim") }"#);
        assert_eq!(t["steps"][0]["action"]["params"]["path"], r"C:\mods\Skyrim");
    }

    #[test]
    fn errors_carry_a_position() {
        let r = compile_inner("task \"T\" {\n  do notify(message)\n}", false);
        assert!(!r.ok);
        assert_eq!(r.errors[0].line, 2, "the error is on the line it is on");
        assert!(r.errors[0].col > 0);
    }

    #[test]
    fn an_unclosed_block_is_reported_not_swallowed() {
        let r = compile_inner(r#"task "T" { if online { do a() }"#, false);
        assert!(!r.ok);
        assert!(
            r.errors[0].message.contains("never closed")
                || r.errors[0].message.contains("Expected"),
            "got: {}",
            r.errors[0].message
        );
    }

    #[test]
    fn text_after_the_task_is_an_error_not_silence() {
        // Almost always a brace closed one line early. Dropping the rest of somebody's
        // automation silently is the worst possible response.
        let r = compile_inner("task \"T\" { do a() }\ndo b()", false);
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("after the task ended"));
    }

    #[test]
    fn a_snippet_needs_no_task_wrapper() {
        let r = compile_inner("do mods.scan()\nwait 5s", true);
        assert!(r.ok, "{:?}", r.errors);
        let steps = r.steps.unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0]["action"]["type"], "mods.scan");
    }

    #[test]
    fn comments_are_ignored_in_both_spellings() {
        let t = compile("task \"T\" {\n  // one\n  # two\n  do a()\n}");
        assert_eq!(t["steps"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn else_if_chains_without_a_special_node() {
        let t = compile(r#"task "T" { if online { stop } else if always { break } }"#);
        let els = t["steps"][0]["else"].as_array().unwrap();
        assert_eq!(els.len(), 1);
        assert_eq!(
            els[0]["kind"], "if",
            "an else-if is a block holding one if — how the editor nests them"
        );
    }

    #[test]
    fn a_duplicate_parameter_is_refused() {
        // Silently keeping the last one would make a typo invisible.
        let r = compile_inner(r#"task "T" { do a(x: 1, x: 2) }"#, false);
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("twice"));
    }

    #[test]
    fn decompiling_prints_parameters_in_a_stable_order() {
        let t = json!({ "name": "T", "trigger": {"type": "manual"}, "steps": [
            { "kind": "action", "action": { "type": "a", "params": { "z": 1, "a": 2, "m": 3 } } }
        ]});
        let a = bmms_decompile(t.clone());
        let b = bmms_decompile(t);
        assert_eq!(a, b);
        assert!(a.contains("do a(a: 2, m: 3, z: 1)"), "got: {}", a);
    }

    #[test]
    fn an_unknown_step_kind_is_kept_as_a_comment() {
        // A tree from a newer BMM must not lose steps when an older one prints it.
        let t = json!({ "name": "T", "trigger": {"type":"manual"}, "steps": [{ "kind": "somethingNew" }] });
        assert!(bmms_decompile(t).contains("unknown step kind"));
    }

    #[test]
    fn legacy_permissions_are_printed_not_dropped() {
        let t = json!({ "name": "T", "trigger": {"type":"manual"}, "allowCustomCommands": true, "steps": [] });
        let s = bmms_decompile(t);
        assert!(s.contains("allow command, deeplink"), "got: {}", s);
    }

    #[test]
    fn variables_and_arithmetic_lower_to_the_actions_that_already_exist() {
        let t = compile(
            r#"task "T" {
                set count = 0
                set count = count + 1
                set label = "hello"
                shared set team = "red"
                clear count
            }"#,
        );
        let a = |i: usize| t["steps"][i]["action"].clone();
        // A NUMBER goes to math.set, whose expression evaluator the runner already has.
        assert_eq!(a(0)["type"], "math.set");
        assert_eq!(a(0)["params"]["target"], "count");
        assert_eq!(a(0)["params"]["expr"], "0");
        assert_eq!(
            a(1)["params"]["expr"],
            "count + 1",
            "the expression is the user's own text"
        );
        // A QUOTED string goes to var.set. That is the whole rule for telling them apart.
        assert_eq!(a(2)["type"], "var.set");
        assert_eq!(a(2)["params"]["value"], "hello");
        assert_eq!(a(3)["params"]["scope"], "shared");
        assert_eq!(a(4)["type"], "var.clear");
    }

    #[test]
    fn a_comparison_lowers_to_the_value_condition() {
        let t = compile(r#"task "T" { if count >= 3 { stop } }"#);
        let c = &t["steps"][0]["condition"];
        assert_eq!(
            c["type"], "value",
            "a compare row, so the brick editor shows a compare row"
        );
        assert_eq!(c["params"]["source"], "count");
        assert_eq!(c["params"]["op"], ">=");
        assert_eq!(c["params"]["value"], 3);
    }

    #[test]
    fn the_two_character_operators_are_not_split() {
        // `>` reading the `=` of `>=` as an assignment is the classic lexer bug here.
        for (src, op) in [
            (">=", ">="),
            ("<=", "<="),
            ("==", "=="),
            ("!=", "!="),
            (">", ">"),
            ("<", "<"),
        ] {
            let t = compile(&format!(r#"task "T" {{ if n {} 1 {{ stop }} }}"#, src));
            assert_eq!(
                t["steps"][0]["condition"]["params"]["op"], op,
                "for `{}`",
                src
            );
        }
    }

    #[test]
    fn an_expression_stops_at_the_closing_brace() {
        // The right-hand side of a `set` runs to the end of the LINE, but a closing brace on
        // that line belongs to the block. Without the guard, `repeat 2 times { set x = 1 }`
        // swallowed the brace into the expression and the loop never closed.
        let t = compile(r#"task "T" { repeat 2 times { set x = 1 } }"#);
        assert_eq!(t["steps"][0]["steps"][0]["action"]["params"]["expr"], "1");
        assert_eq!(t["steps"][0]["kind"], "repeat");
    }

    #[test]
    fn a_hyphen_is_arithmetic_now_not_part_of_a_name() {
        let t = compile(r#"task "T" { set x = count-1 }"#);
        assert_eq!(t["steps"][0]["action"]["params"]["expr"], "count-1");
    }

    #[test]
    fn an_unusable_variable_name_is_refused_at_compile_time() {
        // var.set throws on this at RUN time; a name the substituter cannot match back
        // stores something that looks saved and can never be read.
        let r = compile_inner(r#"task "T" { set my.var = 1 }"#, false);
        assert!(!r.ok);
        assert!(
            r.errors[0].message.contains("not a usable variable name"),
            "got: {}",
            r.errors[0].message
        );
    }

    #[test]
    fn the_new_sugar_round_trips() {
        let src = r#"task "T" {
    manual

    set count = 0
    set label = "hello"
    shared set team = "red"
    if count >= 3 and not online {
        set count = count * 2 + 1
        clear label
    }
}
"#;
        let first = compile(src);
        let printed = bmms_decompile(first.clone());
        let second = compile(&printed);
        assert_eq!(
            first, second,
            "sugar must survive being printed
--- printed ---
{}",
            printed
        );
        // And it must print as SUGAR, not as the actions underneath.
        assert!(
            printed.contains("set count = 0"),
            "got:
{}",
            printed
        );
        assert!(
            printed.contains("shared set team = \"red\""),
            "got:
{}",
            printed
        );
        assert!(
            printed.contains("count >= 3"),
            "got:
{}",
            printed
        );
        assert!(
            !printed.contains("do math.set"),
            "printed the action instead of the sugar:
{}",
            printed
        );
    }

    // ── async, scripts and types ────────────────────────────────────────────
    //
    // These live at the END of the module on purpose. The doc-example test above is
    // REGENERATED by slicing between two function names, and twice now that slice has
    // silently swallowed every test written between them — the suite stayed green with
    // fifteen fewer tests, which is the quietest possible failure. Below the last anchor,
    // nothing can reach them.

    #[test]
    fn parallel_lowers_to_branches() {
        let t = compile(
            r#"task "T" {
                parallel {
                    branch { do mods.scan() }
                    branch { do repo.sync() wait 5s }
                }
            }"#,
        );
        let st = &t["steps"][0];
        assert_eq!(st["kind"], "parallel");
        assert_eq!(st["mode"], "all");
        assert_eq!(st["branches"].as_array().unwrap().len(), 2);
        assert_eq!(st["branches"][1].as_array().unwrap().len(), 2);
    }

    #[test]
    fn parallel_settle_is_an_option_not_a_second_keyword() {
        let t = compile(r#"task "T" { parallel settle { branch { do a() } branch { do b() } } }"#);
        assert_eq!(t["steps"][0]["mode"], "settle");
    }

    #[test]
    fn fewer_than_two_branches_is_refused() {
        // One branch is a sequence with extra words; zero does nothing. Both look fine.
        let r = compile_inner(r#"task "T" { parallel { branch { do a() } } }"#, false);
        assert!(!r.ok);
        assert!(
            r.errors[0].message.contains("at least two"),
            "got: {}",
            r.errors[0].message
        );
    }

    #[test]
    fn spawn_and_run_are_different_actions() {
        let t = compile(r#"task "T" { run "Nightly" spawn "Long job" }"#);
        assert_eq!(t["steps"][0]["action"]["type"], "task.run", "run WAITS");
        assert_eq!(
            t["steps"][1]["action"]["type"], "task.spawn",
            "spawn starts and moves on"
        );
        assert_eq!(t["steps"][0]["action"]["params"]["id"], "Nightly");
    }

    #[test]
    fn a_script_block_keeps_its_body_exactly() {
        // Why the block form exists at all: as an action parameter this needs every quote and
        // newline escaped, so nobody would write it and the escape hatch was theoretical.
        let src = "task \"T\" {
  script python {
    import os
    print(\"hi { }\")
  }
}";
        let t = compile(src);
        let a = &t["steps"][0]["action"];
        assert_eq!(a["type"], "custom.script");
        assert_eq!(a["params"]["engine"], "python");
        let code = a["params"]["code"].as_str().unwrap();
        assert!(code.contains("import os"), "got: {:?}", code);
        assert!(
            code.contains("print("),
            "braces inside the body must not end it: {:?}",
            code
        );
    }

    #[test]
    fn a_script_body_may_contain_anything_the_language_does_not_understand() {
        // The lexer runs over the WHOLE file before the parser slices this body out by
        // offset, so it has to walk past `*.zip` and `$f` without refusing. A documented
        // bash example failed on the dot in `*.zip` until it did.
        let src = "task \"T\" {
  script bash {
    for f in *.zip; do echo \"$f\"; done
  }
}";
        let r = compile_inner(src, false);
        assert!(r.ok, "{:?}", r.errors);
        assert!(r.task.unwrap()["steps"][0]["action"]["params"]["code"]
            .as_str()
            .unwrap()
            .contains("*.zip"));
    }

    #[test]
    fn an_unknown_script_language_is_refused_with_the_list() {
        let r = compile_inner(r#"task "T" { script perl { print 1 } }"#, false);
        assert!(!r.ok);
        assert!(
            r.errors[0].message.contains("powershell"),
            "the message should list them: {}",
            r.errors[0].message
        );
    }

    #[test]
    fn a_declared_type_catches_the_wrong_shape() {
        // The runner has no types at run time, so this is the only place it can be caught.
        let bad1 = compile_inner(r#"task "T" { set n: number = "0" }"#, false);
        assert!(!bad1.ok);
        assert!(
            bad1.errors[0].message.contains("declared `number`"),
            "got: {}",
            bad1.errors[0].message
        );
        let bad2 = compile_inner(r#"task "T" { set s: text = 5 }"#, false);
        assert!(!bad2.ok);
        assert!(
            bad2.errors[0].message.contains("declared `text`"),
            "got: {}",
            bad2.errors[0].message
        );
        // The right shapes compile to the same actions as the untyped form. On SEPARATE
        // lines, because an expression runs to the end of its line.
        let ok = compile(
            "task \"T\" {
  set n: number = 5
  set s: text = \"x\"
}",
        );
        assert_eq!(ok["steps"][0]["action"]["type"], "math.set");
        assert_eq!(ok["steps"][1]["action"]["type"], "var.set");
    }

    #[test]
    fn the_async_and_script_forms_round_trip() {
        let src = "task \"T\" {
    manual

    run \"Setup\"
    parallel settle {
        branch {
            do mods.scan()
        }
        branch {
            script bash {
                echo \"one\"
                echo \"two\"
            }
        }
    }
    spawn \"Cleanup\"
}
";
        let first = compile(src);
        let printed = bmms_decompile(first.clone());
        let re = compile_inner(&printed, false);
        assert!(
            re.ok,
            "the PRINTED text does not compile: {:?}
{}",
            re.errors, printed
        );
        assert_eq!(
            first,
            re.task.unwrap(),
            "must survive printing
{}",
            printed
        );
        assert!(printed.contains("run \"Setup\""), "{}", printed);
        assert!(printed.contains("spawn \"Cleanup\""), "{}", printed);
        assert!(printed.contains("parallel settle {"), "{}", printed);
        assert!(printed.contains("script bash {"), "{}", printed);
        assert!(
            !printed.contains("do custom.script"),
            "the script printed as an action:
{}",
            printed
        );
    }

    #[test]
    fn a_file_may_hold_several_tasks() {
        // Sharing a task that runs two others used to share one third of an automation — the
        // same reason the .bmmpa exporter follows sub-task references.
        let r = compile_inner(
            "task \"Main\" {
  manual
  run \"Helper\"
}

task \"Helper\" {
  manual
  do mods.scan()
}
",
            false,
        );
        assert!(r.ok, "{:?}", r.errors);
        let all = r.tasks.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["name"], "Main");
        assert_eq!(all[1]["name"], "Helper");
        // `task` still holds the first, so every caller that read it keeps working.
        assert_eq!(r.task.unwrap()["name"], "Main");
    }

    #[test]
    fn trailing_junk_still_keeps_its_own_message() {
        // Falling through to "a file starts with task" would be true and useless: the file
        // plainly does, and the real cause is a brace closed a line early.
        let r = compile_inner(
            "task \"T\" { do a() }
do b()",
            false,
        );
        assert!(!r.ok);
        assert!(
            r.errors[0].message.contains("after the task ended"),
            "got: {}",
            r.errors[0].message
        );
    }

    #[test]
    fn a_file_with_no_task_says_so() {
        // Statements at the top level get the BETTER message: p.task() refuses first and
        // names the shape a file should have. The is_empty() guard covers the EMPTY file,
        // which is not the case I assumed when I wrote it.
        let stmts = compile_inner("do mods.scan()", false);
        assert!(!stmts.ok);
        assert!(
            stmts.errors[0].message.contains("A file starts with"),
            "got: {}",
            stmts.errors[0].message
        );

        for src in [
            "",
            "   

  ",
            "// just a comment
",
        ] {
            let r = compile_inner(src, false);
            assert!(!r.ok, "an empty file is not a valid one: {:?}", src);
            assert!(
                r.errors[0].message.contains("no task"),
                "for {:?} got: {}",
                src,
                r.errors[0].message
            );
        }
    }
}
