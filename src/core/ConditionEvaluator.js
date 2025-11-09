/**
 * Safely gets a value from the game context based on a path string.
 * @param {string} path - The path to the property, e.g., "player.index".
 * @param {Party} party - The game state, used to resolve top-level context like 'player'.
 * @returns {any} The value of the property, or undefined if not found.
 */
function getContextValue(path, party) {
    const [context, ...restOfPath] = path.split('.');
    let baseContext;

    if (context === 'player') {
        // The context for 'player' provides properties related to the current player.
        const player = party.players[party.currentPlayerIndex];
        baseContext = {
            index: party.currentPlayerIndex,
            energy: player.energy,
            // In the future, you could add:
            // vanguard: party.players[party.currentPlayerIndex].board.getCircle('V').unit,
            // handSize: party.players[party.currentPlayerIndex].hand.length,
        };
    } else {
        // In the future, you could add 'opponent', 'event', etc.
        return undefined;
    }

    // Traverse the rest of the path if it exists
    return restOfPath.reduce((acc, part) => acc && acc[part], baseContext);
}

/**
 * Evaluates a condition array from the card data.
 * @param {Array | undefined} condition - The condition array to evaluate.
 * @param {Party} party - The current game state.
 * @returns {boolean} - True if the condition passes or if there is no condition.
 */
export function evaluateCondition(condition, party) {
    if (!condition) {
        return true; // No condition means it's always met.
    }

    // Handle logical operators (AND, OR)
    if (condition.includes('and') || condition.includes('or')) {
        // This is a simplified parser for infix notation.
        // It assumes a structure like [ [condition1], 'and', [condition2] ]
        const left = evaluateCondition(condition[0], party);
        const operator = condition[1];
        const right = evaluateCondition(condition[2], party);

        if (operator === 'and') return left && right;
        if (operator === 'or') return left || right;
    }

    // Handle a single comparison expression: [field, operator, value]
    if (condition.length === 3) {
        const [field, operator, value] = condition;
        const fieldValue = getContextValue(field, party);

        if (operator === '===') return fieldValue === value;
        if (operator === '!==') return fieldValue !== value;
        if (operator === '>=') return fieldValue >= value;
        if (operator === '<=') return fieldValue <= value;
        // Add more operators like '>', '<', etc. here
        console.warn(`Unknown operator in condition: ${operator}`);
        return false;
    }

    console.warn('Invalid condition format:', condition);
    return false;
}