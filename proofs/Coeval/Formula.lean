/-
The model of the formula kit over JSON (K96, D159).

This file is a second definition of the kit in `packages/core/src/formula.ts`, with the rules of the split in
`parts.ts` and of a path in `deref.ts`. The machine is `formulaMachine(profile, { plain: true, roots: ["names"] })`, and
the profile has one operation, `add`. The test AGREE.LEAN compares this model with the plan on generated documents.

The function `eval` is total: each call takes a clock, and a clock of zero stops the evaluation. The clock counts the
nesting of the evaluation, not its steps.
-/

namespace Coeval

/-- This type holds a document and a value. Documents are JSON. A value also holds a closure, a held error and `undef`. -/
inductive V where
  | undef
  | null
  | bool (b : Bool)
  | num (n : Int)
  | str (s : String)
  | arr (items : List V)
  | obj (fields : List (String × V))
  | closure (params : List String) (body : V) (names : List (String × V))
  | held (code : String)
  deriving Inhabited

/-- The names of a scope, in order. -/
abbrev Names := List (String × V)

/-- This type tells why an evaluation stopped: an error with its code, or the end of the clock. -/
inductive Stop where
  | error (code : String)
  | clock
  deriving Inhabited

/-- The result of an evaluation. -/
abbrev R := Except Stop V

/-- This function gives the error with a code. -/
def err (code : String) : Except Stop α := .error (.error code)

/-- The limit of the active applications of functions: a quarter of the default `maxDepth`. -/
def applyLimit : Nat := 250

/-- This function gives the value of a field, for a text key. -/
def field (fields : List (String × V)) (key : String) : Option V := fields.lookup key

/-- This function adds a field, or replaces the value of a field that exists. -/
def setField (fields : List (String × V)) (key : String) (value : V) : List (String × V) :=
  if fields.any (fun field => field.1 == key) then
    fields.map (fun field => if field.1 == key then (key, value) else field)
  else
    fields ++ [(key, value)]

/-- This function tells if a value is a key: a text, or a whole number that is not negative. -/
def isKey : V → Bool
  | .str _ => true
  | .num n => n ≥ 0
  | _ => false

/-- This function gives the text of a key. -/
def keyText : V → String
  | .str s => s
  | .num n => toString n
  | _ => ""

/-- This function tells if a value is a reference to a type: a text, a list of keys, or a path into the world. -/
def isTypeRef : V → Bool
  | .str s => s != ""
  | .arr [] => false
  | .arr items => items.all isKey
  | .obj fields =>
    match field fields "type", field fields "value" with
    | some (.str "ref"), some (.arr (.str "world" :: _)) => true
    | _, _ => false
  | _ => false

/-- This function gives the keys of a reference to a type. A path with a step that is not a key gives no keys. -/
def typeKeys : V → List String
  | .str s => [s]
  | .arr items => items.map keyText
  | .obj fields =>
    match field fields "value" with
    | some (.arr (_ :: steps)) => if steps.all isKey then steps.map keyText else []
    | _ => []
  | _ => []

/-- This function tells if the header of a record is the header of an envelope. -/
def headerFits (fields : List (String × V)) : Bool :=
  let nameFits :=
    match field fields "name" with
    | none => true
    | some (.str _) => true
    | _ => false
  let ownFits :=
    match field fields "own" with
    | none => true
    | some (.obj _) => true
    | _ => false
  let typeFits :=
    match field fields "type" with
    | some value => isTypeRef value
    | none => false
  typeFits && (field fields "value").isSome && nameFits && ownFits

/-- This function gives the type and the value of an envelope, or `none` for each other value. -/
def envelope : V → Option (List String × V)
  | .obj fields =>
    if fields.all (fun field => ["type", "value", "name", "own"].contains field.1) && headerFits fields then
      match field fields "type", field fields "value" with
      | some type, some value => some (typeKeys type, value)
      | _, _ => none
    else
      none
  | _ => none

/-- The kinds of the formula kit. The model has no `ext`. -/
inductive Kind where
  | lit | ref | record | list | «let» | fn | call | «if» | and | or
  | op (name : String)

/-- This function finds a kind by the keys of its type. -/
def kindOf : List String → Option Kind
  | ["lit"] => some .lit
  | ["ref"] => some .ref
  | ["record"] => some .record
  | ["list"] => some .list
  | ["let"] => some .let
  | ["fn"] => some .fn
  | ["call"] => some .call
  | ["if"] => some .if
  | ["and"] => some .and
  | ["or"] => some .or
  | "ops" :: first :: rest => some (.op (".".intercalate (first :: rest)))
  | _ => none

/-- This function makes one step of a path on a value. It gives `none` when the step reaches nothing. -/
def plainStep (here key : V) : Option V :=
  match here, key with
  | .arr items, .str "length" => some (.num items.length)
  | .arr items, .num n => items[n.toNat]?
  | .arr items, .str s => if s != "" && s.all Char.isDigit then items[s.toNat!]? else none
  | .obj fields, key => field fields (keyText key)
  | _, _ => none

/-- This function walks the steps of a path after its root. The index of the first step is 1. -/
def walk (index : Nat) (here : V) : List V → R
  | [] => pure here
  | step :: rest =>
    if isKey step then
      match plainStep here step with
      | some next => walk (index + 1) next rest
      | none => err (if index == 1 then "#NAME?" else "#N/A")
    else
      err "#STEP?"

/-- This function evaluates the construct `ref` in a scope. -/
def ref (names : Names) (path : V) : R :=
  match path with
  | .arr (.str "names" :: steps) =>
    let held :=
      match steps with
      | .str name :: _ =>
        match field names name with
        | some (.held code) => some code
        | _ => none
      | _ => none
    match held with
    | some code => err code
    | none =>
      match walk 1 (.obj names) steps with
      | .ok (.held code) => err code
      | result => result
  | .arr (_ :: _) => err "#REF!"
  | _ => err "#VALUE!"

/-- This function evaluates items in order. It gives the first stop. -/
def evalItems (each : V → R) : List V → Except Stop (List V)
  | [] => pure []
  | item :: rest => do
    let value ← each item
    let values ← evalItems each rest
    pure (value :: values)

/-- This function evaluates the fields of a record in order. It gives the first stop. -/
def evalFields (each : V → R) : List (String × V) → Except Stop (List (String × V))
  | [] => pure []
  | (key, item) :: rest => do
    let value ← each item
    let values ← evalFields each rest
    pure ((key, value) :: values)

/-- This function makes the scope of a `let`. A failed binding is a held error. The clock is not an error. -/
def bindAll (each : V → R) (scope : Names) : List (String × V) → Except Stop Names
  | [] => pure scope
  | (key, item) :: rest =>
    match each item with
    | .ok value => bindAll each (setField scope key value) rest
    | .error (.error code) => bindAll each (setField scope key (.held code)) rest
    | .error .clock => .error .clock

/-- This function evaluates the terms of `and` and `or`. The value `stopAt` stops the walk. -/
def logic (each : V → R) (stopAt : Bool) : List V → R
  | [] => pure (.bool (!stopAt))
  | item :: rest =>
    match each item with
    | .ok (.bool truth) => if truth == stopAt then pure (.bool stopAt) else logic each stopAt rest
    | .ok _ => err "#VALUE!"
    | .error stop => .error stop

/-- This function gives the parameters of `fn`: different texts, or `none`. -/
def paramsOf : V → Option (List String)
  | .arr items =>
    let texts := items.filterMap (fun item => match item with | .str s => some s | _ => none)
    if texts.length == items.length && texts.eraseDups.length == texts.length then some texts else none
  | _ => none

/-- This function sums numbers. It gives `none` for each other value, as the operation `add` of the test throws. -/
def addAll : List V → Option Int
  | [] => some 0
  | .num n :: rest => (addAll rest).map (fun sum => n + sum)
  | _ => none

/-- This function binds the parameters of a closure in order. A missing argument is `undef`. -/
def bindParams (scope : Names) : List String → List V → Names
  | [], _ => scope
  | param :: rest, [] => bindParams (setField scope param .undef) rest []
  | param :: rest, arg :: args => bindParams (setField scope param arg) rest args

/-- This function gives the items of a list, or `none` for each other value. -/
def arrItems : V → Option (List V)
  | .arr items => some items
  | _ => none

/-- This function gives the fields of a record, or `none` for each other value. -/
def objFields : V → Option (List (String × V))
  | .obj fields => some fields
  | _ => none

/-- This function applies `k` to the items of a list. Each other value gives `#VALUE!`. -/
def onArr (value : V) (k : List V → R) : R :=
  match arrItems value with
  | some items => k items
  | none => err "#VALUE!"

/-- This function applies `k` to the fields of a record. Each other value gives `#VALUE!`. -/
def onObj (value : V) (k : List (String × V) → R) : R :=
  match objFields value with
  | some fields => k fields
  | none => err "#VALUE!"

/-- This function gives the arguments of `call`: no field gives no arguments, and a value that is not a list gives `none`. -/
def argsOf (fields : List (String × V)) : Option (List V) :=
  match field fields "args" with
  | none => some []
  | some (.arr items) => some items
  | some _ => none

/-- This function evaluates `let`. The function `self` evaluates a part of the document. -/
def kLet (self : Nat → Names → V → R) (applying : Nat) (names : Names) (fields : List (String × V)) : R :=
  match field fields "bind" >>= objFields, field fields "body" with
  | some binds, some body => bindAll (self applying names) names binds >>= fun scope => self applying scope body
  | _, _ => err "#VALUE!"

/-- This function evaluates `call`. The function `self` evaluates a part of the document. -/
def kCall (self : Nat → Names → V → R) (applying : Nat) (names : Names) (fields : List (String × V)) : R :=
  match field fields "fn", argsOf fields with
  | some target, some items =>
    self applying names target >>= fun callee =>
      match callee with
      | .closure params body scope =>
        evalItems (self applying names) items >>= fun values =>
          if applying ≥ applyLimit then
            err "#DEPTH!"
          else
            self (applying + 1) (bindParams scope params values) body
      | _ => err "#VALUE!"
  | _, _ => err "#VALUE!"

/-- This function evaluates `if`. The function `self` evaluates a part of the document. -/
def kIf (self : Nat → Names → V → R) (applying : Nat) (names : Names) (fields : List (String × V)) : R :=
  match field fields "test", field fields "then" with
  | some test, some yes =>
    self applying names test >>= fun truth =>
      match truth with
      | .bool true => self applying names yes
      | .bool false =>
        match field fields "else" with
        | some no => self applying names no
        | none => pure .null
      | _ => err "#VALUE!"
  | _, _ => err "#VALUE!"

/-- This function evaluates an operation. The model knows only `add`. -/
def kOp (self : Nat → Names → V → R) (applying : Nat) (names : Names) (name : String) (items : List V) : R :=
  if name == "add" then
    evalItems (self applying names) items >>= fun values =>
      match addAll values with
      | some sum => pure (.num sum)
      | none => err "#CALC!"
  else
    err "#NAME?"

/-- This function evaluates the value of a kind. The function `self` evaluates a part of the document. -/
def evalKind (self : Nat → Names → V → R) (applying : Nat) (names : Names) (kind : Kind) (value : V) : R :=
  match kind with
  | .lit => pure value
  | .ref => ref names value
  | .list => onArr value fun items => evalItems (self applying names) items >>= fun values => pure (.arr values)
  | .record => onObj value fun fields => evalFields (self applying names) fields >>= fun values => pure (.obj values)
  | .let => onObj value fun fields => kLet self applying names fields
  | .fn => onObj value fun fields =>
    match field fields "params" >>= paramsOf, field fields "body" with
    | some params, some body => pure (.closure params body names)
    | _, _ => err "#VALUE!"
  | .call => onObj value fun fields => kCall self applying names fields
  | .if => onObj value fun fields => kIf self applying names fields
  | .and => onArr value fun items => logic (self applying names) false items
  | .or => onArr value fun items => logic (self applying names) true items
  | .op name => onArr value fun items => kOp self applying names name items

/-- This function gives the keys of the type and the value of a document. A bare value is a literal. -/
def parse (doc : V) : List String × V :=
  match envelope doc with
  | some found => found
  | none => (["lit"], doc)

/--
This function makes one step of the evaluation. The function `self` evaluates each part of the document. The order of the
tests is the order of `examine` in `reference.ts`: the kind, then the split, then the evaluator.
-/
def step (self : Nat → Names → V → R) (applying : Nat) (names : Names) (doc : V) : R :=
  match kindOf (parse doc).1 with
  | none => err "#KIND?"
  | some kind => evalKind self applying names kind (parse doc).2

/-- This function evaluates a document. Each step takes one unit of the clock. -/
def eval : Nat → Nat → Names → V → R
  | 0, _, _, _ => .error .clock
  | clock + 1, applying, names, doc => step (eval clock) applying names doc

/-- The clock of the test. A generated document stops at `applyLimit` long before this clock ends. -/
def testClock : Nat := 100000

/-- A clock of zero stops each evaluation. -/
theorem eval_zero (applying : Nat) (names : Names) (doc : V) :
    (match eval 0 applying names doc with
     | .error .clock => true
     | _ => false) = true := rfl

end Coeval
