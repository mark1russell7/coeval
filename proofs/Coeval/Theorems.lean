/-
Theorems over the model of the formula kit (K223, D194).

- The clock: a result that a clock gives does not change with a larger clock (`eval_add_clock`). Two clocks that both
  give a result give the same result (`eval_clocks_agree`). Thus the result of a document does not depend on the clock.
- Determinism: `eval` is a function, thus a document, its names and its clock give one result (`eval_deterministic`).
- Compositionality of `let`: a `let` evaluates its body in the scope of its bindings (`kLet_eq`), and the bindings of a
  list run in order, thus a list of bindings is the same as its two parts in sequence (`bindAll_append`).

`lake build` checks each proof.
-/
import Coeval.Formula

namespace Coeval

/-- The result `s` extends the result `r`: the clock stopped `r`, or the two results are equal. -/
abbrev Refines {α : Type} (r s : Except Stop α) : Prop := r = .error .clock ∨ r = s

/-- A bind keeps the relation `Refines`. -/
theorem bind_refines {α β : Type} {r r' : Except Stop α} {k k' : α → Except Stop β}
    (hr : Refines r r') (hk : ∀ v, Refines (k v) (k' v)) : Refines (r >>= k) (r' >>= k') := by
  rcases hr with hr | hr
  · rw [hr]
    exact Or.inl rfl
  · rw [← hr]
    cases r with
    | error e => exact Or.inr rfl
    | ok v => exact hk v

/-- The evaluation of items keeps the relation `Refines`. -/
theorem evalItems_refines {f g : V → R} (h : ∀ x, Refines (f x) (g x)) :
    ∀ items, Refines (evalItems f items) (evalItems g items)
  | [] => Or.inr rfl
  | item :: rest => by
    apply bind_refines (h item)
    intro _
    apply bind_refines (evalItems_refines h rest)
    intro _
    exact Or.inr rfl

/-- The evaluation of the fields of a record keeps the relation `Refines`. -/
theorem evalFields_refines {f g : V → R} (h : ∀ x, Refines (f x) (g x)) :
    ∀ fields, Refines (evalFields f fields) (evalFields g fields)
  | [] => Or.inr rfl
  | (_, item) :: rest => by
    apply bind_refines (h item)
    intro _
    apply bind_refines (evalFields_refines h rest)
    intro _
    exact Or.inr rfl

/-- The bindings of a `let` keep the relation `Refines`. -/
theorem bindAll_refines {f g : V → R} (h : ∀ x, Refines (f x) (g x)) :
    ∀ scope binds, Refines (bindAll f scope binds) (bindAll g scope binds)
  | _, [] => Or.inr rfl
  | scope, (key, item) :: rest => by
    rcases h item with hc | he
    · simp only [bindAll]
      rw [hc]
      exact Or.inl rfl
    · simp only [bindAll]
      rw [← he]
      cases f item with
      | ok v => exact bindAll_refines h _ rest
      | error e =>
        cases e with
        | error code => exact bindAll_refines h _ rest
        | clock => exact Or.inr rfl

/-- The terms of `and` and `or` keep the relation `Refines`. -/
theorem logic_refines {f g : V → R} (h : ∀ x, Refines (f x) (g x)) :
    ∀ (stopAt : Bool) (items : List V), Refines (logic f stopAt items) (logic g stopAt items)
  | _, [] => Or.inr rfl
  | stopAt, item :: rest => by
    rcases h item with hc | he
    · simp only [logic]
      rw [hc]
      exact Or.inl rfl
    · simp only [logic]
      rw [← he]
      cases f item with
      | error e => exact Or.inr rfl
      | ok v =>
        cases v <;> try exact Or.inr rfl
        rename_i b
        cases b <;> cases stopAt <;> first | exact Or.inr rfl | exact logic_refines h _ rest

/-- The function `onArr` keeps the relation `Refines`. -/
theorem onArr_refines {k k' : List V → R} (value : V) (hk : ∀ items, Refines (k items) (k' items)) :
    Refines (onArr value k) (onArr value k') := by
  unfold onArr
  cases arrItems value with
  | none => exact Or.inr rfl
  | some items => exact hk items

/-- The function `onObj` keeps the relation `Refines`. -/
theorem onObj_refines {k k' : List (String × V) → R} (value : V) (hk : ∀ fields, Refines (k fields) (k' fields)) :
    Refines (onObj value k) (onObj value k') := by
  unfold onObj
  cases objFields value with
  | none => exact Or.inr rfl
  | some fields => exact hk fields

section Step

variable {f g : Nat → Names → V → R} (h : ∀ a n d, Refines (f a n d) (g a n d))
include h

/-- The evaluation of `let` keeps the relation `Refines`. -/
theorem kLet_refines (a : Nat) (n : Names) (fields : List (String × V)) :
    Refines (kLet f a n fields) (kLet g a n fields) := by
  unfold kLet
  cases field fields "bind" >>= objFields with
  | none => cases field fields "body" <;> exact Or.inr rfl
  | some binds =>
    cases field fields "body" with
    | none => exact Or.inr rfl
    | some body =>
      apply bind_refines (bindAll_refines (h a n) n binds)
      intro scope
      exact h a scope body

/-- The evaluation of `call` keeps the relation `Refines`. -/
theorem kCall_refines (a : Nat) (n : Names) (fields : List (String × V)) :
    Refines (kCall f a n fields) (kCall g a n fields) := by
  unfold kCall
  cases field fields "fn" with
  | none => cases argsOf fields <;> exact Or.inr rfl
  | some target =>
    cases argsOf fields with
    | none => exact Or.inr rfl
    | some items =>
      apply bind_refines (h a n target)
      intro callee
      cases callee <;> try exact Or.inr rfl
      apply bind_refines (evalItems_refines (h a n) items)
      intro values
      by_cases hl : a ≥ applyLimit
      · rw [if_pos hl, if_pos hl]
        exact Or.inr rfl
      · rw [if_neg hl, if_neg hl]
        exact h _ _ _

/-- The evaluation of `if` keeps the relation `Refines`. -/
theorem kIf_refines (a : Nat) (n : Names) (fields : List (String × V)) :
    Refines (kIf f a n fields) (kIf g a n fields) := by
  unfold kIf
  cases field fields "test" with
  | none => cases field fields "then" <;> exact Or.inr rfl
  | some test =>
    cases field fields "then" with
    | none => exact Or.inr rfl
    | some yes =>
      apply bind_refines (h a n test)
      intro truth
      cases truth <;> try exact Or.inr rfl
      rename_i b
      cases b
      · cases field fields "else" with
        | none => exact Or.inr rfl
        | some no => exact h a n no
      · exact h a n yes

/-- The evaluation of an operation keeps the relation `Refines`. -/
theorem kOp_refines (a : Nat) (n : Names) (name : String) (items : List V) :
    Refines (kOp f a n name items) (kOp g a n name items) := by
  unfold kOp
  cases (name == "add")
  · exact Or.inr rfl
  · apply bind_refines (evalItems_refines (h a n) items)
    intro _
    exact Or.inr rfl

/-- The evaluation of each kind keeps the relation `Refines`. -/
theorem evalKind_refines (a : Nat) (n : Names) (kind : Kind) (value : V) :
    Refines (evalKind f a n kind value) (evalKind g a n kind value) := by
  cases kind with
  | lit => exact Or.inr rfl
  | ref => exact Or.inr rfl
  | list =>
    apply onArr_refines
    intro items
    apply bind_refines (evalItems_refines (h a n) items)
    intro _
    exact Or.inr rfl
  | record =>
    apply onObj_refines
    intro fields
    apply bind_refines (evalFields_refines (h a n) fields)
    intro _
    exact Or.inr rfl
  | «let» =>
    apply onObj_refines
    intro fields
    exact kLet_refines h a n fields
  | fn => exact Or.inr rfl
  | call =>
    apply onObj_refines
    intro fields
    exact kCall_refines h a n fields
  | «if» =>
    apply onObj_refines
    intro fields
    exact kIf_refines h a n fields
  | and =>
    apply onArr_refines
    intro items
    exact logic_refines (h a n) false items
  | or =>
    apply onArr_refines
    intro items
    exact logic_refines (h a n) true items
  | op name =>
    apply onArr_refines
    intro items
    exact kOp_refines h a n name items

/-- One step of the evaluation keeps the relation `Refines`. -/
theorem step_refines (a : Nat) (n : Names) (doc : V) : Refines (step f a n doc) (step g a n doc) := by
  unfold step
  cases kindOf (parse doc).1 with
  | none => exact Or.inr rfl
  | some kind => exact evalKind_refines h a n kind _

end Step

/-- One more unit of the clock keeps each result that the clock does not stop. -/
theorem eval_succ_refines :
    ∀ (clock applying : Nat) (names : Names) (doc : V),
      Refines (eval clock applying names doc) (eval (clock + 1) applying names doc)
  | 0, _, _, _ => Or.inl rfl
  | clock + 1, applying, names, doc =>
    step_refines (fun a n d => eval_succ_refines clock a n d) applying names doc

/-- A result that the clock does not stop does not change with a larger clock. -/
theorem eval_add_clock (clock extra applying : Nat) (names : Names) (doc : V)
    (h : eval clock applying names doc ≠ .error .clock) :
    eval (clock + extra) applying names doc = eval clock applying names doc := by
  induction extra with
  | zero => rfl
  | succ k ih =>
    rcases eval_succ_refines (clock + k) applying names doc with hc | he
    · rw [ih] at hc
      exact absurd hc h
    · show eval (clock + k + 1) applying names doc = eval clock applying names doc
      rw [← he, ih]

/-- Two clocks that both give a result give the same result. -/
theorem eval_clocks_agree (first second applying : Nat) (names : Names) (doc : V)
    (h₁ : eval first applying names doc ≠ .error .clock) (h₂ : eval second applying names doc ≠ .error .clock) :
    eval first applying names doc = eval second applying names doc := by
  rcases Nat.le_total first second with hle | hle
  · have hm := eval_add_clock first (second - first) applying names doc h₁
    rw [Nat.add_sub_of_le hle] at hm
    exact hm.symm
  · have hm := eval_add_clock second (first - second) applying names doc h₂
    rw [Nat.add_sub_of_le hle] at hm
    exact hm

/-- A document, its names and its clock give one result. -/
theorem eval_deterministic {clock applying : Nat} {names : Names} {doc : V} {r₁ r₂ : R}
    (h₁ : eval clock applying names doc = r₁) (h₂ : eval clock applying names doc = r₂) : r₁ = r₂ := by
  rw [← h₁, ← h₂]

/-- A `let` evaluates its body in the scope that its bindings make. -/
theorem kLet_eq (self : Nat → Names → V → R) (applying : Nat) (names : Names) (fields : List (String × V))
    (binds : List (String × V)) (body : V)
    (hb : field fields "bind" >>= objFields = some binds) (hd : field fields "body" = some body) :
    kLet self applying names fields =
      (bindAll (self applying names) names binds >>= fun scope => self applying scope body) := by
  unfold kLet
  rw [hb, hd]

/-- The bindings run in order: a list of bindings is the same as its two parts in sequence. -/
theorem bindAll_append (each : V → R) :
    ∀ (scope : Names) (first second : List (String × V)),
      bindAll each scope (first ++ second) = (bindAll each scope first >>= fun inner => bindAll each inner second)
  | _, [], _ => rfl
  | scope, (key, item) :: rest, second => by
    simp only [List.cons_append, bindAll]
    cases each item with
    | ok v => exact bindAll_append each _ rest second
    | error e =>
      cases e with
      | error code => exact bindAll_append each _ rest second
      | clock => rfl

end Coeval
