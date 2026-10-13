# Keep diagnostic metadata useful during Wear OS release troubleshooting.
-keepattributes Signature, InnerClasses, EnclosingMethod, SourceFile, LineNumberTable
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault

# OkHttp/Conscrypt optional platform providers are resolved at runtime.
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Wear OS Tiles/Complications are instantiated by the system from manifest entries.
-keep class com.codexwatch.tiles.** { *; }
-keep class com.codexwatch.complications.** { *; }
