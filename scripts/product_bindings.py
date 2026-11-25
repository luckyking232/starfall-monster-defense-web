"""Temporary route binding for the single shared actor bridge/clock."""
from hashlib import sha256
import posixpath

STAGE_BINDINGS = (
    'composed-stage78-body', 'later-body-probe', 'later-body-six',
    'stage2to6-hud-live', 'stage910-body-probe', 'stage9to20-hud-live',
)
ROOT = 'qualified-game/revisions/r6'
ACTOR = 'actor-bridge.mjs'
CLOCK = 'presentation-clock.mjs'
SHARED = 'src/rendering/actors'
PINS = {
    ACTOR: 'd177a06b70f7b59627396ce9c7b00938d78c60c0933daf9b2165a844cf61f058',
    CLOCK: '5b5283be94dba898825d9a88a230750331877ac241db7984bbea4afecaa1391f',
}

def links(inherited):
    for group in STAGE_BINDINGS:
        dirname = f'{ROOT}/{group}'
        for name in (ACTOR, CLOCK):
            dest = f'{dirname}/{name}'
            if sha256(inherited[dest]).hexdigest() != PINS[name]:
                raise ValueError(f'Shared adapter source drift: {dest}')
            rel = posixpath.relpath(f'{SHARED}/{name}', dirname)
            if name == ACTOR:
                fn = 'openActorBridge'
                exports = 'ACTOR_BRIDGE_SCHEMA,CALIBRATED_CAPTURE_SCHEMA,PROTOCOLS'
                extras, deps = '', 'SCENES'
            else:
                fn = 'openPresentationClock'
                exports = 'PREVIEW_SCHEMA,RECONSTRUCTION'
                extras, deps = "import {openActorBridge} from './actor-bridge.mjs';\n", 'SCENES,openActorBridge'
            yield dest, (
                '/** Compatibility bindings: implementations live in src/rendering/actors. */\n'
                "import {SCENES} from './scene-profiles.mjs';\n"
                f"{extras}import {{{fn} as open}} from '{rel}';\n"
                f"export {{{exports}}} from '{rel}';\n"
                f"export const {fn}=opts=>open({deps},opts);\n"
            ).encode()
