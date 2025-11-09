export default class Circle {
    /**
     * @param {string} name - The name of the circle (e.g., 'V', 'R1').
     * @param {'front'|'back'} row - The row the circle is in.
     */
    constructor(name, row) {
        this.name = name;
        this.row = row;
        this.unit = null; // The card on this circle
    }
}