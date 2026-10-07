class RateLimiter {
    constructor(rate = 10, capacity = 10) {
        this.rate = rate; // tokens per second
        this.capacity = capacity;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }

    tryConsume() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
        this.lastRefill = now;

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
}

module.exports = RateLimiter;
