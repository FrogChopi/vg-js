import cloneDeep from './cloneDeep.js';

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
    for (const card of activePlayer.hand) {
        if (action.cardIdsToRedraw.includes(card.id)) {
            cardsToRedraw.push(card);
        } else {
            cardsToKeep.push(card);
        }
    }

    // Return redrawn cards to the deck
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

    const cardIndex = activePlayer.hand.findIndex(c => c.id === action.cardId);
    if (cardIndex === -1) {
        console.error(`ActionApplier Error: Card with id ${action.cardId} not found in hand.`);
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
function applyGuard(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const defendingPlayer = newGameState.players[1 - newGameState.currentPlayerIndex];

    const cardIndex = defendingPlayer.hand.findIndex(c => c.id === action.cardId);
    if (cardIndex === -1) {
        console.error(`ActionApplier Error: Card with id ${action.cardId} not found in hand for GUARD.`);
        return gameState;
    }

    const [cardToGuard] = defendingPlayer.hand.splice(cardIndex, 1);
    defendingPlayer.guardianZone.push(cardToGuard);
    console.log(`> Player ${1 - newGameState.currentPlayerIndex + 1} guards with ${cardToGuard.name}.`);

    return newGameState;
}

/**
 * Applies an 'INTERCEPT' action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The INTERCEPT action object.
 * @returns {Party} The new game state after the action.
 */
function applyIntercept(gameState, action) {
    const newGameState = cloneDeep(gameState);
    const defendingPlayer = newGameState.players[1 - newGameState.currentPlayerIndex];

    const circle = defendingPlayer.board.getCircle(action.fromCircle);
    if (!circle || !circle.unit || circle.unit.id !== action.cardId) {
        console.error(`ActionApplier Error: Unit with id ${action.cardId} not found on circle ${action.fromCircle} for INTERCEPT.`);
        return gameState;
    }

    const cardToIntercept = circle.unit;
    circle.unit = null; // Remove from board
    cardToIntercept.isResting = true; // Interceptors are moved to GC as rest
    defendingPlayer.guardianZone.push(cardToIntercept);
    console.log(`> Player ${1 - newGameState.currentPlayerIndex + 1} intercepts with ${cardToIntercept.name}.`);

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
    await effectFunction(newGameState, {}, rl);

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
            console.log(`> ${boosterCircle.unit.name} boosts ${attackerCircle.unit.name}! New power: ${attackerPower}`);
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

    console.log(`> Resolving attack: Attacker power ${attackerPower} vs Target power ${targetPower}`);

    if (attackerPower >= targetPower) {
        console.log('> Attack Hits!');
        if (targetCircle.name === 'V') {
            const damage = attackerCircle.unit.critical + attackerCircle.unit.bonusCritical;
            console.log(`> Vanguard takes ${damage} damage.`);
            await newGameState.damageCheck(1 - newGameState.currentPlayerIndex, damage, rl);
        } else {
            console.log(`> Rear-guard ${targetCircle.unit.name} is retired.`);
            opponentPlayer.dropZone.push(targetCircle.unit);
            targetCircle.unit = null;
        }
    } else {
        console.log('> Attack does not hit.');
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
        const cardIndex = activePlayer.hand.findIndex(c => c.id === action.cardInstanceId);
        if (cardIndex === -1) {
            console.error(`ActionApplier Error: Card with id ${action.cardInstanceId} not found in hand for RIDE.`);
            return gameState;
        }
        [cardToRide] = activePlayer.hand.splice(cardIndex, 1);
    } else if (action.source === 'rideDeck') {
        const cardIndex = activePlayer.rideDeck.findIndex(c => c.id === action.cardInstanceId);
        if (cardIndex === -1) {
            console.error(`ActionApplier Error: Card with id ${action.cardInstanceId} not found in ride deck for RIDE.`);
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

    newGameState.phase = 'main'; // Transition to main phase after ride
    return newGameState;
}

/**
 * Applies a 'PASS_RIDE_PHASE' action to the game state.
 * @param {Party} gameState - The current game state.
 * @returns {Party} The new game state after the action.
 */
function applyPassRidePhase(gameState) {
    const newGameState = cloneDeep(gameState);
    newGameState.phase = 'main'; // Transition to main phase
    return newGameState;
}

/**
 * Main dispatcher function to apply an action to the game state.
 * @param {Party} gameState - The current game state.
 * @param {object} action - The action to apply.
 * @returns {Party} The new game state.
 */
export async function applyAction(gameState, action, rl) {
    switch (action.type) {
        case 'MULLIGAN':
            return applyMulligan(gameState, action);
        case 'RIDE':
            return applyRide(gameState, action);
        case 'PASS_RIDE_PHASE':
            return applyPassRidePhase(gameState);
        case 'CALL':
            return applyCall(gameState, action);
        case 'ACT':
            return await applyAct(gameState, action, rl);
        case 'MOVE':
            return applyMove(gameState, action);
        case 'ATTACK':
            return await applyAttack(gameState, action, rl);
        case 'GUARD':
            return applyGuard(gameState, action);
        case 'INTERCEPT':
            return applyIntercept(gameState, action);
        
        case 'PASS_MAIN_PHASE': {
            const newGameState = cloneDeep(gameState);
            newGameState.phase = 'battle'; // Transition to the next phase
            return newGameState;
        }

        case 'PASS_BATTLE_PHASE': {
            const newGameState = cloneDeep(gameState);
            newGameState.phase = 'end'; // Transition to the next phase
            return newGameState;
        }

        case 'PASS_GUARD_STEP': {
            const newGameState = cloneDeep(gameState);
            newGameState.phase = 'drive_check'; // Transition to the drive check step
            return newGameState;
        }

        default:
            console.warn(`Action type "${action.type}" has no applier logic yet.`);
            return gameState; // Return original state if action is unknown
    }
}

export { applyCloseStep };