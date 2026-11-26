"""Native Unity presentation extraction for the monster-defense replica.

Reads the original processed asset bundles with UnityPy and exports the real
object graph (GameObject/Transform/SpriteRenderer/Animator), Sprite
rect/pivot/PPU data, AnimatorController states and fully decoded AnimationClip
sprite curves so the web renderer can be driven by original data instead of
hand-measured guesses.
"""
