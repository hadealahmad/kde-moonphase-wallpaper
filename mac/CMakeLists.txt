# SPDX-License-Identifier: GPL-2.0-or-later
cmake_minimum_required(VERSION 3.24)
# Must precede project(). The bundled Qt can raise the real minimum; package.sh
# writes that into Info.plist.
if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)   # Also replaces an empty value cached by older builds.
    set(CMAKE_OSX_DEPLOYMENT_TARGET "13.0" CACHE STRING "Minimum macOS version" FORCE)
endif()
project(MoonphaseMac VERSION 1.0.0 LANGUAGES CXX OBJCXX)
if(NOT APPLE)
    message(FATAL_ERROR "This entry point builds the macOS host. Use the root Makefile for KDE or windows/ for Windows.")
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_STANDARD 17)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 6.8 REQUIRED COMPONENTS Quick Widgets Network ShaderTools)
find_package(Python3 3.11 REQUIRED COMPONENTS Interpreter)
get_filename_component(SHARED_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)

# Same compatibility copies as the Windows host (KDE imports removed, host
# settings and pause wired in); fonts follow the macOS system font.
set(payload "${CMAKE_CURRENT_BINARY_DIR}/adapted")
set(adapter "${SHARED_ROOT}/windows/scripts/adapt.py")
file(GLOB_RECURSE shared_inputs CONFIGURE_DEPENDS
    "${SHARED_ROOT}/contents/ui/*.qml" "${SHARED_ROOT}/contents/code/*.js"
    "${SHARED_ROOT}/contents/config/*.xml" "${SHARED_ROOT}/contents/images/*")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${adapter}" ${shared_inputs})
file(REMOVE_RECURSE "${payload}")
execute_process(COMMAND "${Python3_EXECUTABLE}" "${adapter}" "${SHARED_ROOT}" "${payload}" "Qt.application.font.family"
    COMMAND_ERROR_IS_FATAL ANY)

set(icon "${CMAKE_CURRENT_SOURCE_DIR}/resources/Moonphase.icns")
set_source_files_properties("${icon}" PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
qt_add_executable(Moonphase MACOSX_BUNDLE
    src/main.cpp src/app.cpp src/app.h src/desktop.mm src/desktop.h "${icon}")
set_target_properties(Moonphase PROPERTIES
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in"
    MACOSX_BUNDLE_GUI_IDENTIFIER "io.github.hadealahmad.moonphase.mac"
    MACOSX_BUNDLE_BUNDLE_NAME "Moonphase"
    MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}")
target_compile_options(Moonphase PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
target_link_libraries(Moonphase PRIVATE Qt6::Quick Qt6::Widgets Qt6::Network
    "-framework AppKit" "-framework ServiceManagement")

file(GLOB_RECURSE resources "${payload}/*")
qt_add_resources(Moonphase "wallpaper" PREFIX "/wallpaper" BASE "${payload}" FILES ${resources})
file(GLOB shaders CONFIGURE_DEPENDS "${SHARED_ROOT}/contents/shaders/*.frag")
qt_add_shaders(Moonphase "shaders" PREFIX "/wallpaper/contents/shaders"
    BASE "${SHARED_ROOT}/contents/shaders" GLSL "150" MSL 12 FILES ${shaders})

include(CTest)
find_program(NODE_EXECUTABLE NAMES node)
if(BUILD_TESTING AND NODE_EXECUTABLE)
    foreach(suite astronomy earth_orbit hijri prayer)
        add_test(NAME ${suite} COMMAND "${NODE_EXECUTABLE}" "${SHARED_ROOT}/tests/test_${suite}.mjs")
    endforeach()
    add_test(NAME adapter COMMAND "${NODE_EXECUTABLE}"
        "${SHARED_ROOT}/windows/tests/test_adapter.mjs" "${payload}")
endif()
