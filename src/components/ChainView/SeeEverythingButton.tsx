import styles from './SeeEverythingButton.module.css'

interface Props {
  onClick: () => void
}

/** The one "See everything" pill — jumps to the full product overview. Shared by
 *  the chain list and the single-chain graph so both stay visually identical and
 *  pinned to their toolbar's right edge (margin-left: auto). */
export function SeeEverythingButton({ onClick }: Props) {
  return (
    <button className={styles.seeAllBtn} onClick={onClick} title="Render the full combined production graph">
      See everything <span className={styles.seeAllIcon}>⊞</span>
    </button>
  )
}
