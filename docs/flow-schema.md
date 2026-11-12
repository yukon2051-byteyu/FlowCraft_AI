# フローJSON 詳細仕様（flow-schema.md）

- スキーマバージョン：**1.0**
- 正本：[backend/app/flow/schema.py](../backend/app/flow/schema.py)（Pydanticモデル）。本書と食い違う場合はコードが正
- 構造検証：[backend/app/flow/validate.py](../backend/app/flow/validate.py)
- 見本：[backend/tests/fixtures/flows/monthly_sales.json](../backend/tests/fixtures/flows/monthly_sales.json)（デモA相当）

---

## 1. 基本方針

| 方針 | 内容 |
|---|---|
| 定義外の項目は拒否 | すべてのオブジェクトで、定義にない項目があれば読込エラー（AIが勝手に項目を足しても通さない） |
| 処理はホワイトリスト | `node_type` は §4 の15種類のみ。任意コードを表す種類は存在しない |
| 値は文字列で保持 | 比較値・固定値・補完値・定数は文字列にそろえて保存（例：`1000`→`"1000"`）。JSONの小数誤差を持ち込まず、実行時に列の型で解釈する |
| データは持たない | Excelの中身は一切含めない。入力は「どんな列が必要か」だけを定義する |
| 参照名で接続 | ノードは「どのデータを使い（`input_references`）、どのデータを作るか（`output_reference`）」を名前で持つ |

## 2. トップレベル

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| `schema_version` | `"1.0"` | ○ | 未対応の値は「未対応のスキーマバージョンです」エラー |
| `engine_version` | 文字列 | ○ | 保存時の処理エンジン版 |
| `flow_id` | UUID | ○ | |
| `flow_version` | 整数 ≥1 | ○ | 保存のたびに+1 |
| `flow_name` | 1〜100文字 | ○ | |
| `description` | 〜2000文字 | | |
| `created_at` / `updated_at` | 日時（タイムゾーン付き） | ○ | |
| `input_definitions` | 配列 | | §3 |
| `nodes` | 配列（最大100） | | §4。**配列の順序＝実行順** |
| `dependencies` | 配列 | | 参照関係から自動計算して保存。読込時に再計算値と一致するか検証 |
| `validation_rules` | オブジェクト | | `max_row_growth_ratio`（既定1.0＝結合で行の増加を認めない）、`amount_tolerance`（既定0） |

## 3. 入力定義 `input_definitions[]`

| 項目 | 型 | 説明 |
|---|---|---|
| `input_id` | 参照名 | 読込ノードが指すID |
| `label` | 文字列 | 画面表示名（例：売上実績） |
| `file_kind` | `xlsx` / `csv` | |
| `sheet_hint` | 文字列 | 既定で選ぶシート名 |
| `header_row` | 1〜100 | 既定1 |
| `columns[]` | | `name`、`type`（`string`/`integer`/`decimal`/`date`/`boolean`）、`scale`（decimalの小数桁）、`date_format`、`required`（既定true）。列名の重複は不可 |

## 4. ノード `nodes[]`

### 4.1 共通項目

| 項目 | 説明 |
|---|---|
| `node_id` | 参照名の形式。フロー内で一意 |
| `node_type` | 下表の15種類 |
| `node_name` | 画面表示名（1〜100文字） |
| `parameters` | 種類ごとの設定（§4.3） |
| `input_references` | 使うデータの参照名。個数は種類ごとに決まる（下表） |
| `output_reference` | 作るデータの参照名。`output` 以外は必須 |
| `confirmation_status` | `unset` / `ai_proposed` / `pending` / `confirmed`。`confirmed` 以外が1つでもあれば実行不可 |
| `open_questions[]` | AIからの確認（`param`, `question`）。残っていれば実行不可 |

**参照名**：英字または `_` で始まり、英数字と `_` のみ、64文字まで（例：`sales_full`）。

### 4.2 種類と入力数

| カテゴリ（仕様6章） | `node_type` | 入力数 | 備考 |
|---|---|---|---|
| ファイル読込 | `load` | 0 | `input_id` で入力定義を指す |
| 行の抽出 | `filter` | 1 | |
| 並べ替え | `sort` | 1 | 安定ソート |
| 列編集 | `select_columns` / `rename_columns` / `drop_columns` / `add_constant` | 1 | `select_columns` は「必要列の抽出」用 |
| 型変換 | `cast` | 1 | |
| 重複処理 | `duplicates` | 1 | `detect` はデータを変えない |
| 欠損値処理 | `missing` | 1 | `detect` はデータを変えない |
| データ結合 | `join` | **2** | **左＝`input_references[0]`、右＝`[1]`** |
| データ連結 | `concat` | 2〜10 | `sources` は `input_references` と同じ順序 |
| グループ別集計 | `aggregate` | 1 | |
| 計算（計算列） | `calculate` | 1 | 仕様6.4の計算列と6.11を統合 |
| Excel出力 | `output` | 1〜10 | `sheets` は `input_references` と同じ順序。出力は持たない |

### 4.3 パラメータ

| node_type | パラメータ |
|---|---|
| `load` | `input_id` |
| `filter` | `condition`：条件（`kind:"condition"`, `column`, `operator`, `value`）またはグループ（`kind:"group"`, `logic: and/or`, `conditions[]`）。入れ子は3段まで。演算子：`eq` `ne` `gt` `ge` `lt` `le` `contains` `not_contains` `is_empty` `is_not_empty`（後ろ2つは `value` 不可、それ以外は必須） |
| `sort` | `keys[]`：`column`, `ascending`（既定true）。最大10 |
| `select_columns` | `columns[]`：残す列（指定順に並ぶ） |
| `rename_columns` | `renames[]`：`source`, `target` |
| `drop_columns` | `columns[]` |
| `add_constant` | `column`, `value`, `value_type` |
| `cast` | `casts[]`：`column`, `to`, `scale`, `date_format`, `rounding`／`on_failure`：`error`（既定・停止）または `warn`（空欄にして件数を警告） |
| `duplicates` | `key_columns[]`, `mode`：`detect`/`remove`, `keep`：`first`/`last` |
| `missing` | `columns[]`, `mode`：`detect`/`fill`/`drop_rows`, `fill_value`（`fill` のときのみ必須・それ以外は指定不可） |
| `join` | `keys[]`：`left`, `right`（最大5）／`how`：`inner`/`left`/`right`/`outer`／**`expected_relationship`（必須）**：`one_to_one`/`one_to_many`/`many_to_one`/`many_to_many`／`unmatched_policy`：`warn`（既定）/`error`／`key_normalization`：`none`（既定）/`trim`／`check_amount_columns[]`／`right_suffix`（既定 `_右`） |
| `concat` | `sources[]`：`reference`, `label`, `renames[]`／`missing_columns`：`error`（既定）/`allow`／`source_column`（どの入力の行かを記録する列名） |
| `aggregate` | `group_by[]`（空なら全体で1行）／`aggregations[]`：`function`（`sum` `mean` `max` `min` `count` `nunique`）, `column`（`count` 以外は必須）, `output_column`, `scale`, `rounding` |
| `calculate` | `output_column`, `expression`（§4.4）, `scale`, `rounding`, `on_zero_division`：`warn`（既定）/`error` |
| `output` | `sheets[]`：`reference`, `sheet_name`（31文字以内、`[]:*?/\` 不可、重複不可） |

**丸め `rounding`**：`half_up`（四捨五入・既定）／`down`（切り捨て）／`up`（切り上げ）／`half_even`（銀行丸め）。

### 4.4 計算式 `expression`

`eval` は使わず、次の3種類の要素の木構造で表す。演算の入れ子は5段まで。

```json
{ "kind": "operation", "op": "subtract",
  "left":  { "kind": "operation", "op": "add",
             "left": { "kind": "column", "column": "期首在庫" },
             "right": { "kind": "column", "column": "入庫数" } },
  "right": { "kind": "column", "column": "出庫数" } }
```

| kind | 項目 |
|---|---|
| `column` | `column`：列名 |
| `constant` | `value`：有限の数値（`NaN`・`Infinity`・文字は不可） |
| `operation` | `op`：`add` `subtract` `multiply` `divide` `ratio_percent`（左÷右×100）, `left`, `right` |

## 5. 構造検証（validate.py）

| コード | 重大度 | 内容 |
|---|---|---|
| `REFERENCE_NOT_YET_DEFINED` | エラー | 下にあるノードの結果を使っている（R1） |
| `UNKNOWN_REFERENCE` | エラー | どのノードも作っていないデータを参照 |
| `DUPLICATE_OUTPUT_REFERENCE` | エラー | 同じデータ名を複数ノードが作る（R2） |
| `DUPLICATE_NODE_ID` / `DUPLICATE_INPUT_ID` | エラー | IDの重複 |
| `UNKNOWN_INPUT_ID` | エラー | 読込ノードが存在しない入力定義を指す |
| `MULTIPLE_OUTPUT_NODES` / `OUTPUT_NOT_LAST` | エラー | 出力ノードは1つ・最後 |
| `DEPENDENCIES_MISMATCH` | エラー | 保存された `dependencies` が参照関係と不一致（手作業での改変） |
| `NO_OUTPUT_NODE` | 警告 | 出力ノードがない |
| `UNUSED_REFERENCE` | 警告 | 使われず出力もされないデータ（R4） |

循環参照（R3）は、R1（上にあるものしか参照できない）により発生しない。

**実行可否**（`execution_blockers`）：上記エラー＋ノードが空（`EMPTY_FLOW`）＋未確定ノード（`NODE_NOT_CONFIRMED`）＋未回答の確認（`OPEN_QUESTIONS`）。

**並べ替え**（`check_move`）：移動後に新たな参照エラーが生じる場合、出力ノードを動かす場合、出力ノードより下へ動かす場合は不可とし、理由を返す（R5）。

## 6. 本書の範囲外（後続タスクで実装）

- 列名の存在確認（各ノードの入出力の列を追跡する検証）：処理エンジン（タスク1-10以降）で実装
- 実データとの互換性検証：タスク3-6
