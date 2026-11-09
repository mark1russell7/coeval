/-
The executable of the model. Each line of the input is a JSON list of two items: the names and the document. An object
of the input has the form `{"o":[[key,value],...]}` and a list has the form `{"a":[...]}`, because the order of the keys
of a record is part of the meaning, and `Lean.Json` keeps its keys in sorted order. Each line of the output is one result.
-/
import Lean.Data.Json
import Coeval.Formula
import Coeval.Theorems

open Lean (Json)
open Coeval

/-- This function reads a value of the input. -/
partial def decode (json : Json) : V :=
  match json with
  | .null => .null
  | .bool b => .bool b
  | .num n => .num n.mantissa
  | .str s => .str s
  | other =>
    match other.getObjVal? "a", other.getObjVal? "o" with
    | .ok (.arr items), _ => .arr (items.toList.map decode)
    | _, .ok (.arr pairs) =>
      .obj <| pairs.toList.filterMap fun pair =>
        match pair.getArrVal? 0, pair.getArrVal? 1 with
        | .ok (.str key), .ok value => some (key, decode value)
        | _, _ => none
    | _, _ => .undef

/-- This function writes a value. The test reads a closure, a held error and `undef` in the same form. -/
partial def encode : V → Json
  | .undef => Json.mkObj [("undefined", .bool true)]
  | .null => .null
  | .bool b => .bool b
  | .num n => Json.num n
  | .str s => .str s
  | .arr items => .arr (items.toArray.map encode)
  | .obj fields => Json.mkObj (fields.map fun field => (field.1, encode field.2))
  | .closure params _ _ => Json.mkObj [("closure", .arr (params.toArray.map Json.str))]
  | .held code => Json.mkObj [("held", .str code)]

/-- This function evaluates one line of the input. -/
def answer (line : String) : Json :=
  match Json.parse line with
  | .error reason => Json.mkObj [("input", .str reason)]
  | .ok input =>
    match input.getArrVal? 0, input.getArrVal? 1 with
    | .ok names, .ok doc =>
      let scope :=
        match decode names with
        | .obj fields => fields
        | _ => []
      match eval testClock 0 scope (decode doc) with
      | .ok value => Json.mkObj [("value", encode value)]
      | .error (.error code) => Json.mkObj [("error", .str code)]
      | .error .clock => Json.mkObj [("clock", .bool true)]
    | _, _ => Json.mkObj [("input", .str "The line is not a list of two items.")]

/-- This function answers each line of the standard input. -/
partial def loop (input : IO.FS.Stream) (output : IO.FS.Stream) : IO Unit := do
  let line ← input.getLine
  if line.isEmpty then
    return
  output.putStrLn (answer line).compress
  loop input output

def main : IO Unit := do
  loop (← IO.getStdin) (← IO.getStdout)
