/**
 * Clean Buddies margin calculation helpers.
 * CRITICAL: Margin-based pricing ONLY — never markup.
 * Formula: Price = Cost ÷ (1 − target_margin)
 */

import { TARGET_MARGIN, FLOOR_MARGIN, BURDENED_LABOR_RATE } from './constants'

/**
 * Calculate the price needed to hit a target gross margin.
 * @param costCents - total burdened cost in cents
 * @param targetMargin - decimal (default 0.65)
 */
export function priceForMargin(costCents: number, targetMargin = TARGET_MARGIN): number {
  if (targetMargin >= 1) throw new Error('Margin must be < 1')
  return Math.ceil(costCents / (1 - targetMargin))
}

/**
 * Calculate gross margin given revenue and cost (all in cents).
 */
export function grossMargin(revenueCents: number, costCents: number): number {
  if (revenueCents <= 0) return 0
  return (revenueCents - costCents) / revenueCents
}

/**
 * Calculate burdened labor cost in cents.
 * @param hours - total hours worked
 * @param burdenedRateDollars - burdened hourly rate in dollars (default from env)
 */
export function burdenedLaborCost(hours: number, burdenedRateDollars = BURDENED_LABOR_RATE): number {
  return Math.round(hours * burdenedRateDollars * 100)
}

/**
 * Get margin color class based on percentage.
 */
export function marginColor(margin: number): 'green' | 'amber' | 'red' {
  if (margin >= 0.65) return 'green'
  if (margin >= 0.50) return 'amber'
  return 'red'
}

/**
 * Get Tailwind text color class for a margin value.
 */
export function marginTextClass(margin: number): string {
  const color = marginColor(margin)
  if (color === 'green') return 'text-brand-green'
  if (color === 'amber') return 'text-accent-amber'
  return 'text-accent-red'
}

/**
 * Format cents to dollar string with commas.
 */
export function formatCents(cents: number, opts?: { showCents?: boolean }): string {
  const dollars = cents / 100
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts?.showCents ? 2 : 0,
    maximumFractionDigits: opts?.showCents ? 2 : 0,
  })
}

/**
 * Format a margin decimal as a percentage string.
 */
export function formatMargin(margin: number): string {
  return `${(margin * 100).toFixed(1)}%`
}

/**
 * Check if a margin meets the floor.
 */
export function meetsFloor(margin: number): boolean {
  return margin >= FLOOR_MARGIN
}

/**
 * Calculate how much a job is below/above floor margin in dollars.
 */
export function marginVariance(revenueCents: number, costCents: number): number {
  const floorRevenue = priceForMargin(costCents, FLOOR_MARGIN)
  return revenueCents - floorRevenue
}
