/**
 * @file ActionManager.js
 * This module is responsible for generating all possible actions for a given game state.
 * The core idea is to have pure functions that take a state and return a list of
 * possible next actions, without modifying the original state.
 */

import { evaluateCondition } from './ConditionEvaluator.js';
/**
 * Generates all possible "call" actions from the hand to the board.
 * @param {object} gameState - The current state of the game.
 * @param {object} activePlayer - The player object for the active player.
 * @returns {object[]} A list of possible CALL actions.
 */
function getCallActions(gameState, activePlayer) {
    const actions = [];
    const vanguard = activePlayer.board.getCircle('V').unit;
    if (!vanguard) return []; // Cannot call without a vanguard

    const vanguardGrade = vanguard.grade;

    // Get all available rear-guard circles
    const availableCircles = [
        ...activePlayer.board.frontRow.filter(c => c.name !== 'V'),
        ...activePlayer.board.backRow
    ];

    // For each card in hand, check if it can be called to any available circle
    for (const card of activePlayer.hand) {
        // Rule: Can only call units with grade <= vanguard's grade
        // A unit must have power. Cards without power (like Orders) cannot be called.
        if (card.power !== null && card.grade <= vanguardGrade) {
            for (const circle of availableCircles) {
                actions.push({
                    type: 'CALL',
                    cardInstanceId: card.uniqueId,
                    cardName: `[G${card.grade}] ${card.name}`, // For clearer display
                    circleTag: circle.name
                });
            }
        }
    }

    return actions;
}

/**
 * Generates all possible "move" actions on the board.
 * @param {object} gameState - The current state of the game.
 * @param {object} activePlayer - The player object for the active player.
 * @returns {object[]} A list of possible MOVE actions.
 */
function getMoveActions(gameState, activePlayer) {
    const actions = [];
    const board = activePlayer.board;
    const columns = [['R1', 'R3'], ['R2', 'R5']];

    for (const [frontCircleName, backCircleName] of columns) {
        const frontCircle = board.getCircle(frontCircleName);
        const backCircle = board.getCircle(backCircleName);

        // A move is only possible if at least one of the two circles has a unit.
        if (frontCircle.unit || backCircle.unit) {
            actions.push({
                type: 'MOVE',
                from: frontCircle.unit ? frontCircleName : backCircleName,
                to: frontCircle.unit ? backCircleName : frontCircleName,
                description: `Move units between ${frontCircleName} and ${backCircleName}`
            });
        }
    }

    return actions;
}

/**
 * Generates all possible "ACT" (activatable skill) actions.
 * @param {object} gameState - The current state of the game.
 * @param {object} activePlayer - The player object for the active player.
 * @returns {object[]} A list of possible ACT actions.
 */
function getActActions(gameState, activePlayer) {
    const actions = [];
    // Scan all zones where ACT skills can be used (board, crest zone, etc.)
    const cardsWithPotentialActs = [
        ...activePlayer.board.frontRow.map(c => c.unit),
        ...activePlayer.board.backRow.map(c => c.unit),
        ...activePlayer.crestZone,
    ].filter(Boolean);

    for (const card of cardsWithPotentialActs) {
        if (card.effectsData?.implemented_effects) {
            for (const effect of card.effectsData.implemented_effects) {
                if (effect.is_act) {
                    // Check if the effect has already been used this turn if it's 1/Turn
                    if (effect.once_per_turn && activePlayer.usedTurnlyEffects.includes(effect.function_index)) {
                        continue;
                    }
                    // Check if the condition for the ACT skill is met
                    if (!evaluateCondition(effect.condition, gameState)) {
                        continue;
                    }

                    actions.push({
                        type: 'ACT',
                        cardId: card.id,
                        effect: effect,
                        description: effect.description || `Activate skill of ${card.name}`
                    });
                }
            }
        }
    }
    return actions;
}

/**
 * Generates all possible guard actions for the defending player.
 * @param {object} gameState - The current state of the game.
 * @returns {object[]} A list of possible GUARD/INTERCEPT actions.
 */
function getGuardActions(gameState) {
    const actions = [];
    const defendingPlayer = gameState.players[1 - gameState.currentPlayerIndex];

    // Guard from hand
    for (const card of defendingPlayer.hand) {
        // Can only guard with cards that have a shield value.
        if (typeof card.shield === 'number') {
            actions.push({
                type: 'GUARD',
                cardInstanceId: card.uniqueId,
                cardName: `[G${card.grade}] ${card.name}`,
                shield: card.shield
            });
        }
    }

    // Intercept from board
    const interceptors = defendingPlayer.board.frontRow.filter(c => c.unit && !c.unit.isResting && c.unit.skills.includes('Intercept'));
    for (const circle of interceptors) {
        actions.push({
            type: 'INTERCEPT',
            cardInstanceId: circle.unit.uniqueId,
            cardName: `[G${circle.unit.grade}] ${circle.unit.name}`,
            shield: circle.unit.shield,
            fromCircle: circle.name
        });
    }

    actions.push({ type: 'PASS_GUARD_STEP' });
    return actions;
}

/**
 * Generates all possible actions for the Battle Phase.
 * @param {object} gameState - The current state of the game.
 * @returns {object[]} A list of possible actions.
 */
function getBattlePhaseActions(gameState) {
    const actions = [];
    const activePlayer = gameState.players[gameState.currentPlayerIndex];
    const opponentPlayer = gameState.players[1 - gameState.currentPlayerIndex];

    const potentialAttackers = activePlayer.board.frontRow.filter(c => c.unit && !c.unit.isResting);
    const potentialTargets = opponentPlayer.board.frontRow.filter(c => c.unit);

    if (potentialTargets.length > 0) {
        for (const attackerCircle of potentialAttackers) {
            // Check for a valid booster
            const backRowCircleName = { 'R1': 'R3', 'V': 'R4', 'R2': 'R5' }[attackerCircle.name];
            let boosterCircle = null;
            if (backRowCircleName) {
                const circle = activePlayer.board.getCircle(backRowCircleName);
                if (circle && circle.unit && !circle.unit.isResting && circle.unit.skills.includes('Boost')) {
                    boosterCircle = circle;
                }
            }

            const createAttackAction = (shouldBoost) => {
                for (const targetCircle of potentialTargets) {
                    actions.push({
                        type: 'ATTACK',
                        attacker: {
                            name: attackerCircle.name,
                            card: attackerCircle.unit
                        },
                        target: {
                            name: targetCircle.name,
                            card: targetCircle.unit
                        },
                        boost: shouldBoost
                    });
                }
            };

            if (boosterCircle) {
                createAttackAction(true); // Create actions WITH boost
                createAttackAction(false); // Create actions WITHOUT boost
            } else {
                createAttackAction(false); // Create actions without boost only
            }
        }
    }

    // Always possible to end the Battle Phase
    actions.push({ type: 'PASS_BATTLE_PHASE' });

    return actions;
}

/**
 * Generates all possible actions for the Main Phase.
 * @param {object} gameState - The current state of the game.
 * @returns {object[]} A list of possible actions.
 */
function getMainPhaseActions(gameState) {
    const activePlayer = gameState.players[gameState.currentPlayerIndex];
    
    const callActions = getCallActions(gameState, activePlayer);
    const moveActions = getMoveActions(gameState, activePlayer);
    const actActions = getActActions(gameState, activePlayer);
    // const skillActions = getSkillActions(gameState, activePlayground); // To be implemented

    const actions = [
        ...callActions,
        ...moveActions,
        ...actActions,
        // ...skillActions
    ];

    // Always possible to end the Main Phase
    actions.push({ type: 'PASS_MAIN_PHASE' });

    return actions;
}


/**
 * Generates all possible mulligan actions for the current player.
 * Each card in hand can either be kept or redrawn, leading to 2^N options where N is hand size.
 * @param {object} gameState - The current state of the game (Party).
 * @param {object} activePlayer - The player object for the active player.
 * @returns {object[]} A list of possible MULLIGAN actions.
 */
function getMulliganActions(gameState, activePlayer) {
    const actions = [];
    const handSize = activePlayer.hand.length;

    // Generate all combinations of keeping/redrawing cards
    // Each bit in 'i' represents a card: 0 = keep, 1 = redraw
    for (let i = 0; i < Math.pow(2, handSize); i++) {
        const cardIndicesToRedraw = [];
        for (let j = 0; j < handSize; j++) {
            // If the j-th bit is set, redraw the j-th card
            if ((i >> j) & 1) {
                cardIndicesToRedraw.push(j);
            }
        }
        actions.push({
            type: 'MULLIGAN',
            cardIndicesToRedraw: cardIndicesToRedraw
        });
    }

    return actions;
}

/**
 * Generates all possible "ride" actions for the current player.
 * @param {object} gameState - The current state of the game (Party).
 * @param {object} activePlayer - The player object for the active player.
 * @returns {object[]} A list of possible RIDE actions.
 */
function getRideActions(gameState, activePlayer) {
    const actions = [];
    const currentVanguard = activePlayer.board.getCircle('V').unit;
    const currentVanguardGrade = currentVanguard ? currentVanguard.grade : -1; // -1 if no vanguard yet (e.g., first turn)

    const seenActions = new Set();

    // Ride from hand
    activePlayer.hand.forEach((card, index) => {
        // Can ride a unit with grade +1 or equal to current vanguard
        if (card.grade === currentVanguardGrade + 1 || card.grade === currentVanguardGrade) {
            const action = {
                type: 'RIDE',
                cardName: `[G${card.grade}] ${card.name}`, // For display
                cardId: card.id, // Use non-unique ID for stable matching
                source: 'hand'
            };
            const key = JSON.stringify({ type: action.type, cardId: action.cardId, source: action.source });
            if (!seenActions.has(key)) {
                actions.push(action);
                seenActions.add(key);
            }
        }
    });

    // Ride from ride deck
    const rideDeckCardToRide = activePlayer.rideDeck.find(c => c.grade === currentVanguardGrade + 1);
    if (rideDeckCardToRide) {
        [...new Map(activePlayer.hand.map(card => [card.name, card])).values()].forEach(cardToDiscard => {
            actions.push({
                type: 'RIDE',
                cardName: `[G${rideDeckCardToRide.grade}] ${rideDeckCardToRide.name}`, // For display
                cardId: rideDeckCardToRide.id, // Use non-unique ID for the card to ride
                source: 'rideDeck',
                discardCardId: cardToDiscard.id // Use non-unique ID for stable matching
            });
        });
    }

    // Always possible to pass the ride phase
    actions.push({ type: 'PASS_RIDE_PHASE' });

    return actions;
}

/**
 * Generates actions for resolving optional card effects.
 * @param {object} gameState - The current state of the game.
 * @returns {object[]} A list of possible effect-related actions.
 */
function getEffectActions(gameState) {
    const actions = [];
    if (gameState.eventQueue.length === 0) return actions;

    const currentEvent = gameState.eventQueue[0];
    if (!currentEvent.pendingEffects) {
        // This case should ideally not be hit if logic is correct, but as a fallback:
        currentEvent.pendingEffects = collectEffectsForEvent(currentEvent, gameState);
    }

    const optionalEffects = currentEvent.pendingEffects.filter(p => !p.effect.mandatory);

    for (const effectToActivate of optionalEffects) {
        actions.push({
            type: 'ACTIVATE_EFFECT',
            effectToActivate: effectToActivate,
            description: `Activate effect of ${effectToActivate.cardName}`
        });
    }

    // It's always possible to not activate an optional effect.
    actions.push({
        type: 'PASS_EFFECT',
        description: 'Do not activate an effect'
    });

    return actions;
}

/**
 * Main dispatcher function to get all possible actions for the current game state.
 * It checks the current phase and calls the appropriate handler.
 * @param {object} gameState - The current state of the game, likely an instance of Party.
 * @returns {object[]} A list of all possible actions.
 */
export function getPossibleActions(gameState) {
    const currentPhase = gameState.phase;
    const activePlayer = gameState.players[gameState.currentPlayerIndex];

    switch (currentPhase) {
        case 'mulligan':
            return getMulliganActions(gameState, activePlayer);
        case 'ride':
            return getRideActions(gameState, activePlayer);
        case 'main':
            return getMainPhaseActions(gameState);
        case 'act': // ACT is part of main phase, handled by getMainPhaseActions
            return [];
        case 'battle':
            return getBattlePhaseActions(gameState);
        case 'guard':
            return getGuardActions(gameState);
        case 'effect_resolution':
            return getEffectActions(gameState);
        // Add cases for 'battle', etc.
        default:
            return [{ type: 'PASS' }]; // Default action if phase is unknown
    }
}