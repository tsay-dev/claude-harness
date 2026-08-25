---
paths:
  - "**/crow3_*/tests/**"
  - "**/crow3_*/phpunit.xml*"
---

# 🧪 crow / backend — test design (PHPUnit)

> **The common rules are [common/testing.md](../common/testing.md)** (test only the domain, one test = one behavior,
> include the failure paths, mock only at the boundary, determinism, one command to run, naming, how to treat coverage).
> This document covers, **on top of following those**, PHPUnit-specific style and the exclusion of crow's generated surface. It never restates the common side.
>
> The code follows [common/coding.md](../common/coding.md)'s style (Allman, snake_case, strict comparison, no `!`).
>
> **Write test names and comments in Japanese.**

---

## What to make Red (the kernel and the generated surface are excluded)

This carves the common rule "test only the domain (hand-written)" mechanically for the backend.

**Red targets (hand-written, under `app/`)**

- Instance and static methods **you defined yourself** in `app/classes/_common_/model_<table>.php`
- The extension hooks (`validation_crow_ext()` / `save_crow_ext()` / `trash_crow_ext()` / `delete_crow_ext()`)
- `app/classes/_common_/model_<table>_<table>_service.php` (business decisions spanning several tables — [backend/model.md](./model.md) §3.12)
  and the hand-written methods of `model_<table>_presenter.php`
- `action_*` in `module_*`, and hand-written utilities belonging to no table (a custom helper on `modifier`, for example)

> Everything called from an action (model / service / presenter / util) **neither terminates the request nor calls
> `crow::get_hdb()` / `crow_request` itself**, per [backend/coding.md](./coding.md) §1.1, so a Red test can be written
> **just by passing** row objects, arrays, and (if needed) a mocked `$hdb` **as arguments** (see "Substituting crow's boundaries" below).
> **If you cannot write a test without substituting global state or superglobals**, or
> **the SUT exits mid-way and the test cannot finish** — either one is a §1.1 violation on the implementation side ([backend/coding.md](./coding.md)).
> Do not contort the test to make it pass; report it as an implementation defect.

**Not Red (1) — `engine/kernel/**`**

Never file a test whose SUT is crow itself. For example:

- Sweeping or characterizing the datetime key shapes `crow_db_table_model::input_from_request()` accepts
- Pinning the behavior of the kernel's validation / CSRF / viewpart resolution / the mysqli layer itself
- Characterizations of the "we don't fix the engine directly, so let's measure it and pin a table" kind (that is the framework's concern; if you are fixing an app gate, make **the gate** Red)

**Not Red (2) — the generated members crow injects**

The same set as "never redefine a generated member" in [backend/model.md](./model.md) §3.6. For example:

- The fields themselves, `m_table_name` / `table_name` / `primary_key`
- `sql_select_all()` / `sql_select_one()` (a hand-written method that grew a routine query under a different name *is* a target)
- The constant / enum family: `get_<field>_keys()` / `_map()` / `_symbols()` / `get_<field>_str()` / `<field>_str()`
- A referenced table's `<refer>_row()`
- Sync tests that transcribe, value by value, the agreement between `db_design.txt` and the generated cache or `get_*_map()`

```php
//  NG: kernel の入力形を特性化する（SUT が engine）
public function test_engine_resolves_split_date_keys()
{
    //  crow_db_table_model::input_from_request() を実測して固定する、など
}

//  NG: 生成された定数マップを値ごとに写経する（enum が増えるたびケースが増えるだけ）
public function test_status_map_contains_active()
{
    $this->assertArrayHasKey("active", model_user::get_status_map());
}

//  OK: 手書きドメイン／ゲートが、ある入力のときにどう振る舞うかを検証する
public function test_is_active_returns_false_when_status_is_banned()
{
    $row = new model_user();
    $row->status = "banned";
    $this->assertFalse($row->is_active());
}
```

**Deciding the boundary (come here when unsure)**

| Question | Yes → | No → |
| --- | --- | --- |
| When it fails, is the code you fix under `app/`? | it can be a target | out of scope (kernel / generated surface) |
| Are you about to add to an existing `engine_*_characterization_*` or a generated map sync? | stop | — |
---

## Tooling and placement

- The test runner is **PHPUnit**. Configuration is centralized in `phpunit.xml` (or `phpunit.xml.dist`)
- **The default suite** lives under `tests/` and **mirrors the directory structure of the code under test**
- **The integration suite** (anything connecting to a real DB or real service) is split into `tests/integration/` (see "Separating the suites")
- **One test class** per unit under test (a class or a function). The file name equals the class name
- **State the file-discovery rule explicitly in `phpunit.xml`.** PHPUnit defaults to the `*Test.php` suffix, so
  crow's snake_case naming (`check_value_test.php`) means **nothing is discovered at all**.
  Configure `<directory suffix="_test.php">` in the `<testsuite>`
- **The UC tag** (the common rules' "scoped execution"): put `#[Group('UC-012')]` on the test class
  (`@group UC-012` on PHPUnit 9 and earlier). Run the selection with `phpunit --group UC-012`
- **`@covers REQ-045#accept-standard` in each test method's docblock** (one declared partition class per test; the common rules' "requirement coverage")

## The structure of a test (AAA = Given-When-Then)

Each test is written in the 3 stages **Arrange → Act → Assert**.
This maps directly onto the GWT (Given-When-Then) acceptance criteria the orchestrator passes.

```php
<?php

use PHPUnit\Framework\TestCase;

class check_value_test extends TestCase
{
    //  空文字は不正として false を返す
    public function test_returns_false_when_value_is_empty()
    {
        //  Arrange
        $value = "";

        //  Act
        $result = check_value($value);

        //  Assert
        $this->assertFalse($result);
    }
}
```

> The `i_` prefix is **the mark of something derived from a request parameter**, so
> do not put it on literals you assemble inside a test (doing so dilutes what the mark means).

## Naming

- The test class name is `<target>_test` (snake_case)
- The test method name **starts with `test_` and states the behavior as a sentence**, in snake_case

```php
public function test_rejects_name_when_it_exceeds_max_length()
public function test_returns_error_when_age_is_not_numeric()
```

## Assertions (be rigorously strict)

Observe common/coding.md's "typed comparison for booleans and null" and "no `!`" in tests too.

- Value equality is **`assertSame()`** (strict comparison including type). As a rule, do not use `assertEquals()`
- Truth values are **`assertTrue()` / `assertFalse()`** (never write a negation like `assertTrue( ! $x )`)
- null is **`assertNull()` / `assertNotNull()`**
- Counts, keys, and the like use the dedicated assertions (`assertCount()`, `assertArrayHasKey()`, …) — never count and compare by hand

```php
$this->assertSame(3, $count);          //  == ではなく型込みで一致
$this->assertFalse($is_valid);         //  ! を使わずに false を検証
$this->assertNull($record);
$this->assertCount(2, $rows);
```

## Input variations go in a data provider

The means of implementing the common rule "do not stop at the happy path" in PHPUnit.
Group input variations of the same behavior under **`@dataProvider`** and give each case a name.

```php
/**
 * @dataProvider invalid_names
 */
public function test_rejects_invalid_name( $name_ )
{
    $this->assertFalse(check_value($name_));
}

public static function invalid_names(): array
{
    return
    [
        "empty"       => [""],
        "only_spaces" => ["   "],
        "too_long"    => [str_repeat("a", 256)],
    ];
}
```

## Setup and teardown

- Setup and teardown go in `setUp()` / `tearDown()` (PHPUnit requires camelCase, so these two are the exception to the snake_case rule)
- If you modified global or static state, or a superglobal (`$_GET`, and so on), always restore it

## Substituting crow's boundaries

Mocking is limited to the parts of crow that **touch the outside world**: the DB handle (the `crow::get_hdb()` equivalent) and `crow_request`.

```php
public function test_returns_empty_list_when_no_row_matches()
{
    //  DB 境界をモック（内部ロジックはモックしない）
    $hdb = $this->createMock(crow_hdb::class);
    $hdb->method("select")->willReturn([]);

    $result = list_users($hdb);

    $this->assertSame([], $result);
}
```

---

## Separating the suites (carve by address in `phpunit.xml`)

Tests that connect to a real DB or a real service are split **by folder**, per the common rule
["split suites by what execution requires"](../common/testing.md).
**Never split them with a tag like `@group integration`.** With tags, the moment the default suite's run command
loses its `--exclude-group`, they leak in — and the leak stays green and goes unnoticed.

PHPUnit's default discovery picks up `tests` recursively, so **without an `<exclude>` the integration tests mix into the default suite**.

```xml
<testsuites>
    <testsuite name="default">
        <directory suffix="_test.php">tests</directory>
        <exclude>tests/integration</exclude>
    </testsuite>
    <testsuite name="integration">
        <directory suffix="_test.php">tests/integration</directory>
    </testsuite>
</testsuites>
```

| Suite | Run | When it runs |
| --- | --- | --- |
| Default | `phpunit --testsuite default` | the suite the red-green loop draws from (selection during a round; whole run at a boundary — develop skill §4). **It must go green on a machine with no DB** |
| Integration | `phpunit --testsuite integration` | at a boundary only (before returning, before commit, in CI) |

Directly under `tests/` (the default suite), **always mock** boundaries such as the DB handle, per "Substituting crow's boundaries" above.
When you find yourself wanting a real connection, that test belongs in `tests/integration/`.

---

## ✅ Checklist before starting on tests

- [ ] Did you first check the target's GWT acceptance criteria (passed by the orchestrator)?
- [ ] **Is what you are verifying hand-written domain code (under `app/`)?** (not `engine/kernel`, a generated member, a sweep of enum accessors, or an engine characterization)
- [ ] Does the file-discovery suffix in `phpunit.xml` match crow's naming?
- [ ] Does the test you are about to write connect to a real DB or real service? (if so, `tests/integration/`; if not, directly under `tests/`)
- [ ] Does the default suite in `phpunit.xml` `<exclude>` `tests/integration`?
- [ ] Are you verifying strictly with `assertSame` / `assertTrue|False` / `assertNull` (and not using `!`)?
- [ ] Did you group input variations into a data provider and name the cases? (and not expand a value list from the kernel or the generated surface)
- [ ] Did you restore superglobals and static state?
