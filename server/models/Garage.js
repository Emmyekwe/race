import mongoose from 'mongoose'

export const DEFAULT_CAR_COLOR = '#e63946'
export const DEFAULT_ACCENT_COLOR = '#f8f9fa'
export const TOP_SPEED_MODIFIER_MIN = 0.8
export const TOP_SPEED_MODIFIER_MAX = 1.2
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

const GarageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    selectedCarColor: {
      type: String,
      default: DEFAULT_CAR_COLOR,
      match: HEX_COLOR_RE,
      lowercase: true,
    },
    // Racing stripe and rear wing.
    accentColor: {
      type: String,
      default: DEFAULT_ACCENT_COLOR,
      match: HEX_COLOR_RE,
      lowercase: true,
    },
    // Trade-off tuning: >1 raises top speed but lowers acceleration, <1 does the opposite.
    topSpeedModifier: {
      type: Number,
      default: 1,
      min: TOP_SPEED_MODIFIER_MIN,
      max: TOP_SPEED_MODIFIER_MAX,
    },
  },
  { timestamps: true, versionKey: false },
)

export default mongoose.models.Garage || mongoose.model('Garage', GarageSchema)
