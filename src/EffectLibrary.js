/**
 * @file EffectLibrary.js
 * This file contains the implementation of card effects.
 * Each function corresponds to an effect that can be triggered by game events.
 * The index of a function in the `effects` array is its ID.
 */

/**
 * Effect 0: [AUTO]:When this unit is rode upon, if you went second, draw a card.
 * Card: Energy Generator
 * @param {Party} party - The current game state.
 * @param {object} eventPayload - The data associated with the event.
 */
async function onRideIfSecondDraw(party, eventPayload, rl) {
    const [riddedCard, riddingCard] = eventPayload.target;
    const playerIndex = party.currentPlayerIndex;

    console.log(`> Effect of "${riddedCard.name}" resolved: Player ${playerIndex + 1} draws a card.`);
    party.draw(playerIndex, 1);
}

/**
 * Effect 1: [AUTO] Ride Deck: When you ride, put this card into the crest zone, and if you went second, [Energy-Charge 3].
 * @param {Party} party - The current game state.
 * @param {object} eventPayload - The data associated with the event.
 */
async function onRideEnergyCrest(party, eventPayload, rl) {
    const playerIndex = party.currentPlayerIndex;
    const player = party.players[playerIndex];

    // Find the crest in the ride deck and move it to the crest zone
    const crestIndex = player.rideDeck.findIndex(c => c.name === 'Energy Generator');
    if (crestIndex !== -1) {
        const [crestCard] = player.rideDeck.splice(crestIndex, 1);
        player.crestZone.push(crestCard);
        console.log(`> ${crestCard.name} moved to the Crest Zone.`);

        // Add the continuous effect for max energy
        player.continuousEffects.push({
            id: 'MAX_ENERGY_10',
            effect: (p) => { p.maxEnergy = 10; }
        });
        console.log(`> [CONT] effect applied: Max energy is now 10.`);
    }

    // If player went second, Energy-Charge 3
    if (playerIndex === 1) {
        console.log('> Player 2 went second, Energy-Charging 3.');
        player.energy += 3;
    }
}

/**
 * Effect 2: [AUTO]: At the beginning of your ride phase, [Energy-Charge 3].
 * @param {Party} party - The current game state.
 */
async function onRidePhaseStartEnergyCrest(party, eventPayload, rl) {
    const playerIndex = party.currentPlayerIndex;
    const player = party.players[playerIndex];
    console.log(`> Effect of Energy Generator: [Energy-Charge 3].`);
    player.energy += 3;
}

/**
 * Effect 3: [ACT][1/Turn]:[COST][Energy-Blast 7], and draw a card.
 * @param {Party} party - The current game state.
 */
async function onActEnergyCrest(party, eventPayload, rl) {
    const playerIndex = party.currentPlayerIndex;
    party.players[playerIndex].energy -= 7;
    console.log(`> Paid cost: Energy Blast 7. Remaining energy: ${party.players[playerIndex].energy}`);
    party.draw(playerIndex, 1);
    console.log('> Drew 1 card.');
}

export const effects = [onRideIfSecondDraw, onRideEnergyCrest, onRidePhaseStartEnergyCrest, onActEnergyCrest];