import Circle from './Circle.js';

export default class Board {
    /**
     * @param {Card | null} startingVanguard - The starting vanguard card (Grade 0).
     */
    constructor(startingVanguard = null) {
        // Front Row
        this.R1 = new Circle('R1', 'front');
        this.V = new Circle('V', 'front');
        this.R2 = new Circle('R2', 'front');
        
        // Back Row
        this.R3 = new Circle('R3', 'back');
        this.R4 = new Circle('R4', 'back');
        this.R5 = new Circle('R5', 'back');

        // By default, place the grade 0 from the ride deck as the vanguard.
        if (startingVanguard) {
            this.V.unit = startingVanguard;
        }
    }

    get frontRow() {
        return [this.R1, this.V, this.R2];
    }

    get backRow() {
        return [this.R3, this.R4, this.R5];
    }

    getCircle(name) {
        const circle = [this.V, this.R1, this.R2, this.R3, this.R4, this.R5].find(c => c.name === name);
        if (!circle) {
            throw new Error(`Circle with name ${name} not found.`);
        }
        return circle;
    }

    /**
     * Prints the board state to the console.
     * @param {boolean} sens - If true, prints R1/V/R2 on top. If false, prints R2/V/R1 on top (opponent's view).
     */
    print(sens = true) {
        const cardWidth = 22;

        const formatCard = (circle) => {
            if (!circle.unit) {
                return ' '.repeat(cardWidth);
            }
            const unit = circle.unit;
            // The resting status is not yet implemented on Card, so we'll default to false
            const resting = (unit.isResting ? '*' : ' ').padEnd(1);
            const grade = `G${unit.grade ?? '?'}`;
            const power = (unit.power ?? 0) + unit.bonusPower;
            const cardStr = `${resting}${grade} / ${power}`;
            return cardStr.padEnd(cardWidth);
        };

        const frontRowCircles = sens ? [this.R1, this.V, this.R2] : [this.R2, this.V, this.R1];
        const backRowCircles = sens ? [this.R3, this.R4, this.R5] : [this.R5, this.R4, this.R3];

        const frontRowStr = frontRowCircles.map(formatCard).join('|');
        const backRowStr = backRowCircles.map(formatCard).join('|');

        if (sens) { // Player's view: front row then back row
            console.log(`|${frontRowStr}|`);
            console.log(`|${backRowStr}|`);
        } else { // Opponent's view: back row then front row
            console.log(`|${backRowStr}|`);
            console.log(`|${frontRowStr}|`);
        }
    }
}