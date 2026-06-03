allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Force a consistent JVM target (17) across ALL modules. Some bundled plugins
// (e.g. tflite_flutter) compile Java at 11 while Kotlin defaults to the JDK
// level (21 here), which trips Gradle's "Inconsistent JVM-target" check and
// fails the build. Setting both Java and Kotlin to 17 everywhere fixes it.
// `withGroovyBuilder` configures the AGP `android` extension dynamically so the
// root build script needs no AGP type on its classpath.
// Force a consistent JVM target (17) across every module. Some bundled plugins
// (e.g. tflite_flutter, flutter_tts) leave Java at 11 while Kotlin defaults to
// JDK 21, which trips AGP's "Inconsistent JVM-target" check. We override the
// AGP `android.compileOptions` AFTER each plugin module's own build.gradle runs
// (afterEvaluate), and set Kotlin lazily. The :app module is already 17/17 and
// is force-evaluated early (evaluationDependsOn above), so we only try-set it.
subprojects {
    val setJava17: () -> Unit = {
        extensions.findByName("android")?.withGroovyBuilder {
            "compileOptions" {
                setProperty("sourceCompatibility", JavaVersion.VERSION_17)
                setProperty("targetCompatibility", JavaVersion.VERSION_17)
            }
        }
        Unit
    }
    if (project.state.executed) {
        runCatching { setJava17() } // already finalized (e.g. :app, already 17) — ignore
    } else {
        afterEvaluate { setJava17() }
    }
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile::class.java)
        .configureEach {
            compilerOptions {
                jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
            }
        }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
