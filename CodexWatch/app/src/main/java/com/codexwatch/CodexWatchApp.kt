package com.codexwatch

import android.app.Application
import com.codexwatch.ui.AppViewModel

class CodexWatchApp : Application() {
    val vm: AppViewModel by lazy { AppViewModel(this) }
}
