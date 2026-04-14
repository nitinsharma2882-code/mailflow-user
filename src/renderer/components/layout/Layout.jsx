import React from 'react'
import Sidebar from './Sidebar'
import Topbar  from './Topbar'
import styles  from './Layout.module.css'

export default function Layout({ children, licenseInfo }) {
  return (
    <div className={styles.app}>
      <Sidebar />
      <div className={styles.main}>
        <Topbar licenseInfo={licenseInfo} />
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  )
}
