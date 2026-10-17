import mongoose from 'mongoose'

export const USERNAME_COLLATION = Object.freeze({ locale: 'en', strength: 2 })

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: /^[a-zA-Z0-9_]+$/,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.passwordHash
        return ret
      },
    },
  },
)

// Case-insensitive uniqueness: "Racer" and "racer" are the same account.
// Queries must use .collation(USERNAME_COLLATION) to hit this index.
UserSchema.index({ username: 1 }, { unique: true, collation: USERNAME_COLLATION })

export default mongoose.models.User || mongoose.model('User', UserSchema)
