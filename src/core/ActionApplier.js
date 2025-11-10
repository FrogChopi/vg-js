import cloneDeep from './cloneDeep.js';
import { effects as effectLibrary } from './EffectLibrary.js';
import { evaluateCondition } from './ConditionEvaluator.js';

/**
 * Applies a 'MULLIGAN' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The MULLIGAN action object { type, cardIdsToRedraw }.
 * @returns {Party} The new game state after the action.
 */
function applyMulligan(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];

    const cardsToKeep = [];
    const cardsToRedraw = [];

    // Separate cards to keep and cards to redraw
    activePlayer.hand.forEach((card, index) => {
        if (action.cardIndicesToRedraw.includes(index)) {
            cardsToRedraw.push(card);
        } else {
            cardsToKeep.push(card);
        }
    });

    // Return redrawn cards to the deck
    // Reset card state before putting them back in the deck
    cardsToRedraw.forEach(card => {
        card.isResting = false;
        card.bonusPower = 0;
        card.bonusCritical = 0;
        card.isPublic = false;
        // Potentially more properties to reset if they are added later
    });
    activePlayer.deck.unshift(...cardsToRedraw); // Add to top of deck for shuffling
    activePlayer.hand = cardsToKeep;

    // Shuffle the deck
    newGameState.shuffleDeck(newGameState.currentPlayerIndex);

    // Draw new cards to match the original hand size
    newGameState.draw(newGameState.currentPlayerIndex, cardsToRedraw.length);

    // Transition to the next phase/player's mulligan
    if (newGameState.currentPlayerIndex === 0) {
        // Player 1 finished mulligan, now Player 2's turn to mulligan
        newGameState.currentPlayerIndex = 1;
    } else {
        // Player 2 finished mulligan, now start Player 1's Stand Phase
        newGameState.currentPlayerIndex = 0;
        newGameState.phase = 'stand';
    }

    return newGameState;
}

/**
 * Applies a 'CALL' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The CALL action object { type, cardId, circleTag }.
 * @returns {Party} The new game state after the action.
 */
function applyCall(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];

    const cardIndex = action.cardIndexInHand;
    if (cardIndex < 0 || cardIndex >= activePlayer.hand.length) {
        console.error(`ActionApplier Error: Card with index ${action.cardIndexInHand} not found in hand for CALL.`);
        return gameState; // Return original state on error
    }

    const [cardToCall] = activePlayer.hand.splice(cardIndex, 1);
    const targetCircle = activePlayer.board.getCircle(action.circleTag);

    if (!targetCircle) {
        console.error(`ActionApplier Error: Circle with tag ${action.circleTag} not found.`);
        return gameState; // Return original state
    }

    // If there's already a unit, it goes to the drop zone
    if (targetCircle.unit) {
        activePlayer.dropZone.push(targetCircle.unit);
    }

    targetCircle.unit = cardToCall;

    return newGameState;
}

/**
 * Applies a 'MOVE' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The MOVE action object { type, from, to }.
 * @returns {Party} The new game state after the action.
 */
function applyMove(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];
    const board = activePlayer.board;

    const circle1 = board.getCircle(action.from);
    const circle2 = board.getCircle(action.to);

    // Swap the units between the two circles
    const tempUnit = circle1.unit;
    circle1.unit = circle2.unit;
    circle2.unit = tempUnit;

    return newGameState;
}

/**
 * Applies a 'GUARD' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The GUARD action object.
 * @returns {Party} The new game state after the action.
 */
function applyGuard(gameState, action, rl) {
    const newGameState = cloneDeep(gameState);
    const defendingPlayer = newGameState.players[1 - newGameState.currentPlayerIndex];

    const cardIndex = defendingPlayer.hand.findIndex(c => c.uniqueId === action.cardInstanceId);
    if (cardIndex === -1) {
        console.error(`ActionApplier Error: Card with instance id ${action.cardInstanceId} not found in hand for GUARD.`);
        return gameState;
    }

    const [cardToGuard] = defendingPlayer.hand.splice(cardIndex, 1);
    defendingPlayer.guardianZone.push(cardToGuard);
    if (rl) console.log(`> Player ${1 - newGameState.currentPlayerIndex + 1} guards with ${cardToGuard.name}.`);

    return newGameState;
}

/**
 * Applies an 'INTERCEPT' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The INTERCEPT action object.
 * @returns {Party} The new game state after the action.
 */
function applyIntercept(gameState, action, rl) {
    const newGameState = cloneDeep(gameState);
    const defendingPlayer = newGameState.players[1 - newGameState.currentPlayerIndex];

    const circle = defendingPlayer.board.getCircle(action.fromCircle);
    if (!circle || !circle.unit || circle.unit.uniqueId !== action.cardInstanceId) {
        console.error(`ActionApplier Error: Unit with instance id ${action.cardInstanceId} not found on circle ${action.fromCircle} for INTERCEPT.`);
        return gameState;
    }

    const cardToIntercept = circle.unit;
    circle.unit = null; // Remove from board
    cardToIntercept.isResting = true; // Interceptors are moved to GC as rest
    defendingPlayer.guardianZone.push(cardToIntercept);
    if (rl) console.log(`> Player ${1 - newGameState.currentPlayerIndex + 1} intercepts with ${cardToIntercept.name}.`);

    return newGameState;
}

/**
 * Applies an 'ACT' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The ACT action object.
 * @returns {Party} The new game state after the action.
 */
async function applyAct(gameState, action, rl) {
    const newGameState = cloneDeep(gameState);
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];
    const { effect } = action;

    // Check if player can pay the cost
    if (effect.cost?.energy && activePlayer.energy < effect.cost.energy) {
        console.log(`> Cannot activate: not enough energy.`);
        return gameState; // Return original state if cost cannot be paid
    }

    // Mark as used if it's a 1/Turn effect
    if (effect.once_per_turn) {
        activePlayer.usedTurnlyEffects.push(effect.function_index);
    }

    // Execute the effect function
    const effectFunction = effectLibrary[effect.function_index];
    if (effectFunction) await effectFunction(newGameState, {}, rl);

    return newGameState;
}

/**
 * Applies an 'ATTACK' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The ATTACK action object.
 * @returns {Party} The new game state after the action.
 */
async function applyAttack(gameState, action, rl) {
    let newGameState = cloneDeep(gameState);
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];
    const opponentPlayer = newGameState.players[1 - newGameState.currentPlayerIndex];

    const attackerCircle = activePlayer.board.getCircle(action.attacker.name);
    const targetCircle = opponentPlayer.board.getCircle(action.target.name);

    if (!attackerCircle?.unit || !targetCircle?.unit) {
        console.error('ActionApplier Error: Invalid attacker or target for ATTACK.');
        return gameState;
    }

    // 1. Rest the attacker
    attackerCircle.unit.isResting = true;

    let attackerPower = attackerCircle.unit.power + attackerCircle.unit.bonusPower;

    // 2. Handle Boost
    if (action.boost) {
        const backRowCircleName = { 'R1': 'R3', 'V': 'R4', 'R2': 'R5' }[attackerCircle.name];
        const boosterCircle = activePlayer.board.getCircle(backRowCircleName);
        if (boosterCircle?.unit) {
            boosterCircle.unit.isResting = true;
            attackerPower += (boosterCircle.unit.power + boosterCircle.unit.bonusPower);
            if (rl) console.log(`> ${boosterCircle.unit.name} boosts ${attackerCircle.unit.name}! New power: ${attackerPower}`);
        }
    }

    // Store battle information in the game state to be used across phases
    newGameState.currentBattle = {
        attackerCircle,
        targetCircle,
        attackerPower
    };

    // 3. Transition to Guard Step
    newGameState.phase = 'guard';

    return newGameState;
}

/**
 * Applies the final step of a battle after checks are done.
 * @param {Party} gameState - The current game state.
 * @param {readline.Interface} rl - The readline interface.
 * @returns {Party} The new game state.
 */
async function applyCloseStep(gameState, rl) {
    const newGameState = cloneDeep(gameState);
    const { attackerCircle, targetCircle, attackerPower } = newGameState.currentBattle;
    const opponentPlayer = newGameState.players[1 - newGameState.currentPlayerIndex];

    const totalShield = opponentPlayer.guardianZone.reduce((sum, card) => sum + (card.shield || 0), 0);
    const targetPower = targetCircle.unit.power + targetCircle.unit.bonusPower + totalShield;

    if (rl) console.log(`> Resolving attack: Attacker power ${attackerPower} vs Target power ${targetPower}`);

    if (attackerPower >= targetPower) {
        if (rl) console.log('> Attack Hits!');
        if (targetCircle.name === 'V') {
            const damage = attackerCircle.unit.critical + attackerCircle.unit.bonusCritical;
            if (rl) console.log(`> Vanguard takes ${damage} damage.`);
            if (rl) await newGameState.damageCheck(1 - newGameState.currentPlayerIndex, damage, rl);
        } else {
            if (rl) console.log(`> Rear-guard ${targetCircle.unit.name} is retired.`);
            opponentPlayer.dropZone.push(targetCircle.unit);
            targetCircle.unit = null;
        }
    } else {
        if (rl) console.log('> Attack does not hit.');
    }

    // End of battle: move guardians to drop zone
    opponentPlayer.dropZone.push(...opponentPlayer.guardianZone);
    opponentPlayer.guardianZone = [];
    newGameState.currentBattle = null; // Clear battle info

    // Check if there are any more units that can attack
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];
    const potentialAttackers = activePlayer.board.frontRow.filter(c => c.unit && !c.unit.isResting);
    if (potentialAttackers.length === 0) {
        newGameState.phase = 'end'; // No more attackers, end battle phase
    } else {
        newGameState.phase = 'battle'; // Return to battle phase for next attack
    }

    return newGameState;
}


/**
 * Applies a 'RIDE' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The RIDE action object { type, cardId, source }.
 * @returns {Party} The new game state after the action.
 */
function applyRide(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const activePlayer = newGameState.players[newGameState.currentPlayerIndex];

    let cardToRide;
    if (action.source === 'hand') {
        const cardIndex = activePlayer.hand.findIndex(c => c.id === action.cardId);
        if (cardIndex === -1) {
            console.error(`ActionApplier Error: Card with id ${action.cardId} not found in hand for RIDE.`);
            return gameState;
        }
        [cardToRide] = activePlayer.hand.splice(cardIndex, 1);
    } else if (action.source === 'rideDeck') {
        const cardIndex = activePlayer.rideDeck.findIndex(c => c.id === action.cardId);
        if (cardIndex === -1) {
            console.error(`ActionApplier Error: Card with id ${action.cardId} not found in ride deck for RIDE.`);
            return gameState;
        }
        [cardToRide] = activePlayer.rideDeck.splice(cardIndex, 1);

        // Discard a card from hand as part of the cost
        const discardCardIndex = activePlayer.hand.findIndex(c => c.id === action.discardCardId);
        if (discardCardIndex === -1) {
            console.error(`ActionApplier Error: Card to discard with id ${action.discardCardId} not found in hand.`);
            return gameState;
        }
        const [discardedCard] = activePlayer.hand.splice(discardCardIndex, 1);
        activePlayer.dropZone.push(discardedCard);
    } else {
        console.error(`ActionApplier Error: Unknown source for RIDE action: ${action.source}.`);
        return gameState;
    }

    const vanguardCircle = activePlayer.board.getCircle('V');
    if (vanguardCircle.unit) {
        activePlayer.soul.push(vanguardCircle.unit); // Move current vanguard to soul

        // Push the ON_RIDE event to the queue
        newGameState.eventQueue.push({
            type: 'ON_RIDE',
            target: [vanguardCircle.unit, cardToRide] // [card ridden upon, new card]
        });
    }
    vanguardCircle.unit = cardToRide; // Place new card as vanguard

    // The next phase will be determined by the event processor after handling ON_RIDE.
    // We set it here, and processEvents will use it after the queue is clear.
    newGameState.nextPhase = 'main'; 
    return newGameState;
}

/**
 * Applies a 'PASS_RIDE_PHASE' action to the game state.
 * @param {Party} gameState - The current game state.
 * @returns {Party} The new game state after the action.
 */
function applyPassRidePhase(gameState) {
    const newGameState = cloneDeep(gameState);
    return newGameState;
}

function collectEffectsForEvent(event, party) {
    const pendingEffects = [];
    const eventTriggerName = event.type.toLowerCase();

    // Collect cards from all relevant zones for both players
    const allCardsInPlay = [];
    for (let i = 0; i < party.players.length; i++) {
        const player = party.players[i];
        allCardsInPlay.push(
            ...player.board.frontRow.map(c => ({ card: c.unit, zone: 'board', ownerIndex: i })),
            ...player.board.backRow.map(c => ({ card: c.unit, zone: 'board', ownerIndex: i })),
            ...player.rideDeck.map(c => ({ card: c, zone: 'rideDeck', ownerIndex: i })),
            ...player.crestZone.map(c => ({ card: c, zone: 'crestZone', ownerIndex: i })),
            ...player.soul.map(c => ({ card: c, zone: 'soul', ownerIndex: i }))
        );
    }

    for (const { card, zone, ownerIndex } of allCardsInPlay.filter(item => item.card)) {
        if (card.effectsData?.implemented_effects) {
            for (const effect of card.effectsData.implemented_effects) {
                if (effect.trigger !== eventTriggerName) continue;
                if (effect.zone && effect.zone !== zone) continue;
                // For now, assume effects only trigger for their owner.
                if (ownerIndex !== party.currentPlayerIndex) continue;
                if (!evaluateCondition(effect.condition, party)) continue;

                pendingEffects.push({
                    cardName: card.name,
                    cardId: card.id, // Using non-unique ID for effect definition matching
                    effect: effect,
                    eventPayload: event
                });
            }
        }
    }
    return pendingEffects;
}

async function applyActivateEffect(gameState, action, rl) {
    const newGameState = cloneDeep(gameState);
    const { effectToActivate } = action;
    const currentEvent = newGameState.eventQueue[0];

    // Find the original full pending effect object using the simplified info from the action.
    // This is necessary to retrieve the eventPayload and cardName.
    const originalPendingEffect = currentEvent?.pendingEffects.find(p =>
        p.cardId === effectToActivate.cardId && p.effect.function_index === effectToActivate.effect.function_index
    );

    if (!originalPendingEffect) {
        console.error('ActionApplier Error: Could not find the original pending effect to activate.');
        return gameState;
    }

    const effectFunction = effectLibrary[effectToActivate.effect.function_index];
    if (effectFunction) {
        if (rl) console.log(`> Activating effect of ${originalPendingEffect.cardName}`);
        await effectFunction(newGameState, originalPendingEffect.eventPayload, rl);
    }

    // Remove the activated effect from the pending list for the current event
    if (currentEvent && currentEvent.pendingEffects) {
        const indexToRemove = currentEvent.pendingEffects.findIndex(p => 
            p.cardId === effectToActivate.cardId && p.effect.function_index === effectToActivate.effect.function_index
        );
        if (indexToRemove > -1) {
            currentEvent.pendingEffects.splice(indexToRemove, 1);
        }
    }

    return newGameState;
}

function applyPassEffect(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const currentEvent = newGameState.eventQueue[0];

    if (currentEvent && currentEvent.pendingEffects) {
        // Passing means we clear all OPTIONAL effects for the current event.
        // Mandatory ones must be resolved.
        currentEvent.pendingEffects = currentEvent.pendingEffects.filter(p => p.effect.mandatory);
    }
    
    return newGameState;
}

/**
 * After an action, this function checks the event queue and resolves any mandatory effects
 * or sets the phase to 'effect_resolution' if there are optional effects.
 * @param {Party} gameState 
 * @param {*} rl 
 */
async function processEvents(gameState, rl) {
    let party = gameState;
    while (party.eventQueue.length > 0) {
        const currentEvent = party.eventQueue[0];
        
        // If pending effects for this event haven't been collected, collect them.
        if (!currentEvent.pendingEffects) {
            currentEvent.pendingEffects = collectEffectsForEvent(currentEvent, party);
        }

        const mandatoryEffects = currentEvent.pendingEffects.filter(p => p.effect.mandatory);
        const optionalEffects = currentEvent.pendingEffects.filter(p => !p.effect.mandatory);

        if (mandatoryEffects.length > 0) {
            // Auto-resolve the first mandatory effect
            const effectToResolve = mandatoryEffects[0];
            if (rl) console.log(`> Auto-activating mandatory effect of ${effectToResolve.cardName}`);

            const effectFunction = effectLibrary[effectToResolve.effect.function_index];
            // Remove from pending BEFORE applying, to prevent infinite loops if the effect adds new events.
            currentEvent.pendingEffects.splice(currentEvent.pendingEffects.indexOf(effectToResolve), 1);

            await effectFunction(party, effectToResolve.eventPayload, rl);
            continue;
        }

        if (optionalEffects.length > 0) {
            // There are choices to be made, so we enter the effect resolution phase and wait for player/AI input.
            party.phase = 'effect_resolution';
            return party;
        }

        // If there are no more pending effects for this event, remove the event and check the next one.
        party.eventQueue.shift();
    }

    // If the queue is empty, we can proceed to the phase that was set before event processing.
    party.phase = party.nextPhase || 'main';
    return party;
}


/**
 * Main dispatcher function to apply an action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The action to apply.
 * @returns {Party} The new game state.
 */
export async function applyAction(gameState, action, rl) {
    let newGameState;
    let postActionPhase = null; // The phase to go to after the action and its events are resolved.

    switch (action.type) {
        case 'MULLIGAN':
            return applyMulligan(gameState, action);
        case 'RIDE':
            newGameState = applyRide(gameState, action);
            postActionPhase = 'main';
            break;
        case 'PASS_RIDE_PHASE':
            newGameState = applyPassRidePhase(gameState);
            postActionPhase = 'main';
            break;
        case 'CALL':
            return applyCall(gameState, action);
        case 'ACT':
            newGameState = await applyAct(gameState, action, rl);
            break;
        case 'ACTIVATE_EFFECT':
            newGameState = await applyActivateEffect(gameState, action, rl);
            break;
        case 'MOVE':
            return applyMove(gameState, action);
        case 'ATTACK':
            newGameState = await applyAttack(gameState, action, rl);
            break;
        case 'GUARD':
            return applyGuard(gameState, action, rl);
        case 'INTERCEPT':
            return applyIntercept(gameState, action, rl);
        case 'PASS_EFFECT':
            return applyPassEffect(gameState, action);
        case 'PASS_MAIN_PHASE': {
            newGameState = cloneDeep(gameState);
            postActionPhase = 'battle';
            break;
        }

        case 'PASS_BATTLE_PHASE': {
            newGameState = cloneDeep(gameState);
            postActionPhase = 'end';
            break;
        }

        case 'PASS_GUARD_STEP': {
            newGameState = cloneDeep(gameState);
            postActionPhase = 'drive_check';
            break;
        }

        case 'PROCESS_EVENTS': {
            newGameState = cloneDeep(gameState);
            break;
        }

        default:
            if (action.type !== 'PASS') {
                console.warn(`Action type "${action.type}" has no applier logic yet.`);
            }
            newGameState = cloneDeep(gameState);
            break;
    }

    // If an action resulted in a state that needs event processing, do it now.
    // This is crucial for effect resolution loops.
    if (action.type === 'ACTIVATE_EFFECT' || action.type === 'PASS_EFFECT') {
        return await processEvents(newGameState, rl);
    } else if (postActionPhase) {
        newGameState.nextPhase = postActionPhase;
        return await processEvents(newGameState, rl);
    }

    return newGameState;
}

export { applyCloseStep };