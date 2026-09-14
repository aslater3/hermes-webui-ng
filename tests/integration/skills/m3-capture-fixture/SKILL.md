---
name: m3-capture-fixture
description: Isolated CI fixture for the supported Hermes secret-entry workflow.
required_environment_variables:
  - name: HERMES_M3_CAPTURE_KEY
    prompt: Enter the disposable CI test value through the secure request card.
---
This fixture makes no network requests and runs no scripts. Report only whether setup is available. Never reveal a supplied value.
